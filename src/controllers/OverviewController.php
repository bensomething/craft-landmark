<?php

namespace bensomething\landmark\controllers;

use bensomething\landmark\Plugin;
use bensomething\landmark\web\assets\field\LandmarkFieldAsset;
use Craft;
use craft\helpers\Cp;
use craft\helpers\Json;
use craft\web\Controller;
use yii\web\Response;

/**
 * Every shape from one field's sources on a single map, filtered by its relation.
 * Double-clicking a shape opens its entry.
 */
class OverviewController extends Controller
{
    public function actionIndex(): Response
    {
        $this->requireCpRequest();
        $this->requirePermission('accessPlugin-landmark');

        $plugin = Plugin::getInstance();
        $fields = $plugin->overviewFields();

        if (!$plugin->getSettings()->overviewMap || $fields === []) {
            return $this->renderTemplate('landmark/_overview', ['config' => null, 'fields' => [], 'field' => null]);
        }

        // Picked from the menu beside the title, or the first field
        $handle = $this->request->getQueryParam('field');
        $field = array_values(array_filter($fields, fn($f) => $f->handle === $handle))[0] ?? $fields[0];

        $settings = $plugin->getSettings();
        $view = Craft::$app->getView();
        $view->registerAssetBundle(LandmarkFieldAsset::class);

        $config = [
            // Choices are kept per field, since each has its own sources
            'name' => 'overview:' . $field->handle,
            'basemapUrl' => $settings->tileUrl(),
            'basemapAttribution' => $settings->attribution(),
            'hasSatellite' => $settings->resolvedGoogleApiKey() !== null,
            'esriImagery' => $settings->esriImagery,
            'centre' => [
                $field->defaultLat ?? $settings->defaultLat,
                $field->defaultLng ?? $settings->defaultLng,
            ],
            'zoom' => $field->defaultZoom ?? $settings->defaultZoom,
            'opacity' => $settings->shapeOpacity,
            'sources' => $field->contextSources(),
            'relations' => $field->contextRelations,
            'icons' => [
                'layers' => Cp::iconSvg('layer-group'),
            ],
        ];

        $view->registerJs(sprintf('new Landmark.Overview(%s, %s);', Json::encode('landmark-overview'), Json::encode($config)));

        return $this->renderTemplate('landmark/_overview', [
            'config' => $config,
            'fields' => $fields,
            'field' => $field,
        ]);
    }
}
