<?php

namespace bensomething\landmark\models;

use Craft;
use craft\base\Model;
use craft\helpers\App;

class Settings extends Model
{
    public const BASEMAP_OSM = 'osm';
    public const BASEMAP_CARTO = 'carto';
    public const BASEMAP_OTHER = 'other';

    /** Which basemap fields draw: osm, carto or other. */
    public string $basemap = self::BASEMAP_OSM;

    /** A key from the CARTO_STYLES list. */
    public string $cartoStyle = 'light_all';

    /** CARTO basemaps need a key, free from carto.com. */
    public string $cartoApiKey = '';

    /** Tile URL for the Other option. A {key} placeholder is replaced, otherwise the key is appended. */
    public string $customUrl = '';
    public string $customApiKey = '';
    public string $customAttribution = '';

    /** Google key with the Map Tiles API enabled. Empty means no satellite layer. */
    public string $googleApiKey = '';

    public float $defaultLat = 51.1533;
    public float $defaultLng = -2.5886;
    public int $defaultZoom = 14;

    public int $height = 420;

    /** How solid a shape is drawn, unless it carries an opacity of its own. */
    public float $shapeOpacity = 0.1;

    public const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    public const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    public const CARTO_URL = 'https://{s}.basemaps.cartocdn.com/%s/{z}/{x}/{y}{r}.png';
    public const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

    /** @var array<string, string> */
    public const CARTO_STYLES = [
        'light_all' => 'Positron',
        'light_nolabels' => 'Positron, no labels',
        'dark_all' => 'Dark Matter',
        'dark_nolabels' => 'Dark Matter, no labels',
        'rastertiles/voyager' => 'Voyager',
        'rastertiles/voyager_nolabels' => 'Voyager, no labels',
        'rastertiles/voyager_labels_under' => 'Voyager, labels under',
    ];

    protected function defineRules(): array
    {
        return [
            [['basemap'], 'in', 'range' => [self::BASEMAP_OSM, self::BASEMAP_CARTO, self::BASEMAP_OTHER]],
            [['cartoStyle'], 'in', 'range' => array_keys(self::CARTO_STYLES)],
            [['cartoApiKey'], 'required', 'when' => fn(self $model) => $model->basemap === self::BASEMAP_CARTO],
            [['customUrl'], 'required', 'when' => fn(self $model) => $model->basemap === self::BASEMAP_OTHER],
            [['cartoApiKey', 'customUrl', 'customApiKey', 'customAttribution', 'googleApiKey'], 'string'],
            [['defaultLat'], 'number', 'min' => -90, 'max' => 90],
            [['defaultLng'], 'number', 'min' => -180, 'max' => 180],
            [['defaultZoom'], 'integer', 'min' => 0, 'max' => 22],
            [['height'], 'integer', 'min' => 200, 'max' => 1200],
            [['shapeOpacity'], 'number', 'min' => 0, 'max' => 1],
        ];
    }

    /** The tile URL a field should load, with any key filled in. */
    public function tileUrl(): string
    {
        return match ($this->basemap) {
            self::BASEMAP_CARTO => $this->withKey(
                sprintf(self::CARTO_URL, $this->cartoStyle),
                App::parseEnv($this->cartoApiKey)
            ),
            self::BASEMAP_OTHER => $this->withKey(
                App::parseEnv($this->customUrl) ?: '',
                App::parseEnv($this->customApiKey)
            ),
            default => self::OSM_URL,
        };
    }

    public function attribution(): string
    {
        return match ($this->basemap) {
            self::BASEMAP_CARTO => self::CARTO_ATTRIBUTION,
            self::BASEMAP_OTHER => $this->customAttribution,
            default => self::OSM_ATTRIBUTION,
        };
    }

    public function resolvedGoogleApiKey(): ?string
    {
        $key = App::parseEnv($this->googleApiKey);

        return is_string($key) && $key !== '' ? $key : null;
    }

    /** Replaces a {key} placeholder, or appends the key as a query parameter. */
    private function withKey(mixed $url, mixed $key): string
    {
        $url = is_string($url) ? $url : '';
        $key = is_string($key) ? trim($key) : '';

        if ($url === '' || $key === '') {
            return str_replace('{key}', '', $url);
        }

        if (str_contains($url, '{key}')) {
            return str_replace('{key}', rawurlencode($key), $url);
        }

        return $url . (str_contains($url, '?') ? '&' : '?') . 'key=' . rawurlencode($key);
    }

    public function attributeLabels(): array
    {
        return [
            'basemap' => Craft::t('landmark', 'Basemap'),
            'cartoStyle' => Craft::t('landmark', 'CARTO Style'),
            'cartoApiKey' => Craft::t('landmark', 'CARTO API Key'),
            'customUrl' => Craft::t('landmark', 'Tile URL'),
            'customApiKey' => Craft::t('landmark', 'API Key'),
            'customAttribution' => Craft::t('landmark', 'Attribution'),
            'googleApiKey' => Craft::t('landmark', 'Google Maps API Key'),
            'defaultLat' => Craft::t('landmark', 'Default Latitude'),
            'defaultLng' => Craft::t('landmark', 'Default Longitude'),
            'defaultZoom' => Craft::t('landmark', 'Default Zoom'),
            'height' => Craft::t('landmark', 'Map Height'),
            'shapeOpacity' => Craft::t('landmark', 'Shape Opacity'),
        ];
    }
}
