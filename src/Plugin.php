<?php

namespace bensomething\landmark;

use bensomething\landmark\fields\Map as MapField;
use bensomething\landmark\models\Settings;
use Craft;
use craft\base\Model;
use craft\events\RegisterComponentTypesEvent;
use craft\events\RegisterUrlRulesEvent;
use craft\services\Fields;
use craft\web\UrlManager;
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
    public bool $hasCpSection = true;

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

        Event::on(
            UrlManager::class,
            UrlManager::EVENT_REGISTER_CP_URL_RULES,
            static function(RegisterUrlRulesEvent $event) {
                $event->rules['landmark'] = 'landmark/overview/index';
            }
        );
    }

    /** The overview map appears once it's turned on and a field has sources to show. */
    public function getCpNavItem(): ?array
    {
        if (!$this->getSettings()->overviewMap || $this->overviewFields() === []) {
            return null;
        }

        return array_merge(parent::getCpNavItem(), [
            'label' => Craft::t('landmark', 'Map'),
            'icon' => 'compass-drafting',
        ]);
    }

    /**
     * The Landmark fields the overview map can show: those drawing other entries' shapes.
     *
     * @return MapField[]
     */
    public function overviewFields(): array
    {
        return array_values(array_filter(
            Craft::$app->getFields()->getFieldsByType(MapField::class),
            fn($field) => $field instanceof MapField && $field->contextSources() !== []
        ));
    }

    protected function createSettingsModel(): ?Model
    {
        return new Settings();
    }

    protected function settingsHtml(): ?string
    {
        return Craft::$app->getView()->renderTemplate('landmark/_settings', [
            'settings' => $this->getSettings(),
            'toolOptions' => MapField::editingToolOptions(),
        ]);
    }
}
