<?php

namespace bensomething\landmark\web\assets\field;

use craft\web\AssetBundle;
use craft\web\assets\codemirror\CodeMirrorAsset;
use craft\web\assets\cp\CpAsset;

/** Leaflet and Geoman ship with the plugin, so the editor works without a CDN. */
class LandmarkFieldAsset extends AssetBundle
{
    public $sourcePath = __DIR__ . '/dist';
    public $depends = [CpAsset::class, CodeMirrorAsset::class];
    public $js = [
        'vendor/leaflet.js',
        'vendor/leaflet-geoman.js',
        'landmark.js',
    ];
    public $css = [
        'vendor/leaflet.css',
        'vendor/leaflet-geoman.css',
        'landmark.css',
    ];
}
