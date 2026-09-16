<?php

namespace bensomething\landmark\controllers;

use bensomething\landmark\Plugin;
use Craft;
use craft\helpers\Json;
use craft\web\Controller;
use yii\web\Response;

/**
 * Google requires a session token before any tile request, so it is fetched and cached here
 * rather than from the browser.
 */
class TilesController extends Controller
{
    private const SESSION_ENDPOINT = 'https://tile.googleapis.com/v1/createSession';
    private const CACHE_KEY = 'landmark.google.session';

    public function actionSession(): Response
    {
        $this->requireAcceptsJson();
        $this->requireCpRequest();

        $key = Plugin::getInstance()->getSettings()->resolvedGoogleApiKey();

        if ($key === null) {
            return $this->asJson(['error' => Craft::t('landmark', 'No Google Maps API key is set.')]);
        }

        $session = $this->session($key);

        if (is_string($session) === false) {
            return $this->asJson(['error' => $session['error'] ?? Craft::t('landmark', 'Couldn’t start a Google tiles session.')]);
        }

        return $this->asJson([
            'tileUrl' => sprintf(
                'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=%s&key=%s',
                rawurlencode($session),
                rawurlencode($key)
            ),
            // TODO: Google's copyright line comes from their viewport endpoint, per viewport.
            'attribution' => 'Imagery ©' . date('Y') . ' Google',
        ]);
    }

    /**
     * A cached or fresh session token, or an array carrying Google's error message.
     *
     * @return string|array<string, string>
     */
    private function session(string $key): string|array
    {
        $cache = Craft::$app->getCache();
        $cached = $cache->get(self::CACHE_KEY);

        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $client = Craft::createGuzzleClient(['timeout' => 10, 'http_errors' => false]);

        try {
            $response = $client->post(self::SESSION_ENDPOINT . '?key=' . rawurlencode($key), [
                'json' => [
                    'mapType' => 'satellite',
                    'language' => 'en-GB',
                    'region' => 'GB',
                ],
            ]);
            $body = Json::decodeIfJson((string)$response->getBody());
        } catch (\Throwable $e) {
            Craft::warning('Landmark couldn’t reach Google: ' . $e->getMessage(), __METHOD__);
            return ['error' => $e->getMessage()];
        }

        $session = is_array($body) ? ($body['session'] ?? null) : null;

        if (!is_string($session) || $session === '') {
            $message = is_array($body) ? ($body['error']['message'] ?? 'Google returned no session.') : 'Google returned no session.';
            Craft::warning('Landmark couldn’t start a Google tiles session: ' . $message, __METHOD__);

            return ['error' => $message];
        }

        $expiry = (int)($body['expiry'] ?? 0);
        $seconds = $expiry > time() ? min($expiry - time() - 60, 86400) : 3600;
        $cache->set(self::CACHE_KEY, $session, max($seconds, 60));

        return $session;
    }
}
