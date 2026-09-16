<?php

namespace bensomething\landmark\tests\Unit;

use bensomething\landmark\models\Settings;
use PHPUnit\Framework\TestCase;

class SettingsTest extends TestCase
{
    public function testOpenStreetMapByDefault(): void
    {
        $settings = new Settings();

        $this->assertSame(Settings::OSM_URL, $settings->tileUrl());
        $this->assertSame(Settings::OSM_ATTRIBUTION, $settings->attribution());
    }

    public function testCartoUrlCarriesStyleAndKey(): void
    {
        $settings = new Settings([
            'basemap' => Settings::BASEMAP_CARTO,
            'cartoStyle' => 'rastertiles/voyager',
            'cartoApiKey' => 'abc123',
        ]);

        $this->assertSame(
            'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=abc123',
            $settings->tileUrl()
        );
        $this->assertStringContainsString('CARTO', $settings->attribution());
    }

    public function testCustomUrlReplacesKeyPlaceholder(): void
    {
        $settings = new Settings([
            'basemap' => Settings::BASEMAP_OTHER,
            'customUrl' => 'https://tiles.example.com/{z}/{x}/{y}.png?token={key}',
            'customApiKey' => 'xyz',
        ]);

        $this->assertSame('https://tiles.example.com/{z}/{x}/{y}.png?token=xyz', $settings->tileUrl());
    }

    public function testCustomUrlAppendsKeyAfterExistingQuery(): void
    {
        $settings = new Settings([
            'basemap' => Settings::BASEMAP_OTHER,
            'customUrl' => 'https://tiles.example.com/{z}/{x}/{y}.png?style=dark',
            'customApiKey' => 'xyz',
        ]);

        $this->assertSame('https://tiles.example.com/{z}/{x}/{y}.png?style=dark&key=xyz', $settings->tileUrl());
    }

    public function testCustomUrlWithoutKeyIsLeftAlone(): void
    {
        $settings = new Settings([
            'basemap' => Settings::BASEMAP_OTHER,
            'customUrl' => 'https://tiles.example.com/{z}/{x}/{y}.png',
            'customAttribution' => 'Example',
        ]);

        $this->assertSame('https://tiles.example.com/{z}/{x}/{y}.png', $settings->tileUrl());
        $this->assertSame('Example', $settings->attribution());
    }

    public function testSatelliteOffWithoutGoogleKey(): void
    {
        $this->assertNull((new Settings())->resolvedGoogleApiKey());
        $this->assertSame('key', (new Settings(['googleApiKey' => 'key']))->resolvedGoogleApiKey());
    }
}
