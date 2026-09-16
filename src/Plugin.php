<?php

namespace bensomething\landmark;

use bensomething\landmark\fields\Map as MapField;
use bensomething\landmark\models\Settings;
use Craft;
use craft\base\Model;
use craft\events\RegisterComponentTypesEvent;
use craft\services\Fields;
use yii\base\Event;

/**
 * Landmark: a field for drawing markers, lines and shapes on a map, stored as GeoJSON.
 *
 * @method Settings getSettings()
 */
class Plugin extends \craft\base\Plugin
{
    public string $schemaVersion = '1.0.0';
    public bool $hasCpSettings = true;

    public function init(): void
    {
        parent::init();

        Event::on(
            Fields::class,
            Fields::EVENT_REGISTER_FIELD_TYPES,
            static function(RegisterComponentTypesEvent $event) {
                $event->types[] = MapField::class;
            }
        );
    }

    protected function createSettingsModel(): ?Model
    {
        return new Settings();
    }

    protected function settingsHtml(): ?string
    {
        return Craft::$app->getView()->renderTemplate('landmark/_settings', [
            'settings' => $this->getSettings(),
        ]);
    }
}
