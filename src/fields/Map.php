<?php

namespace bensomething\landmark\fields;

use bensomething\landmark\models\Shape;
use bensomething\landmark\Plugin;
use bensomething\landmark\web\assets\field\LandmarkFieldAsset;
use Craft;
use craft\base\ElementInterface;
use craft\base\Field;
use craft\elements\db\ElementQueryInterface;
use craft\helpers\Cp;
use craft\helpers\Json;
use yii\db\Schema;

class Map extends Field
{
    /** @var string[] Any of 'marker', 'line', 'polygon' */
    public array $shapes = ['polygon'];

    public bool $allowMultiple = false;

    /** Null falls back to the plugin's settings. */
    public ?float $defaultLat = null;
    public ?float $defaultLng = null;
    public ?int $defaultZoom = null;

    public ?int $height = null;

    /** @var string[] UIDs of Landmark fields whose shapes are drawn behind this one */
    public array $contextFields = [];

    /** UID of a relation field both entries share, so only matching entries are shown. */
    public ?string $contextRelation = null;

    public int $contextLimit = 250;

    public static function displayName(): string
    {
        return Craft::t('landmark', 'Landmark');
    }

    public static function icon(): string
    {
        return 'map-pin';
    }

    public static function dbType(): string
    {
        return Schema::TYPE_TEXT;
    }

    public static function isRequirable(): bool
    {
        return true;
    }

    protected function defineRules(): array
    {
        return array_merge(parent::defineRules(), [
            [['shapes'], 'required'],
            [['defaultLat'], 'number', 'min' => -90, 'max' => 90],
            [['defaultLng'], 'number', 'min' => -180, 'max' => 180],
            [['defaultZoom'], 'integer', 'min' => 0, 'max' => 22],
            [['height'], 'integer', 'min' => 200, 'max' => 1200],
            [['contextLimit'], 'integer', 'min' => 1, 'max' => 2000],
        ]);
    }

    public function normalizeValue(mixed $value, ?ElementInterface $element = null): mixed
    {
        if ($value instanceof Shape) {
            return $value;
        }

        if (is_string($value) && $value !== '') {
            $value = Json::decodeIfJson($value);
        }

        return new Shape(is_array($value) ? $value : null);
    }

    public function serializeValue(mixed $value, ?ElementInterface $element = null): mixed
    {
        if (!$value instanceof Shape) {
            $value = $this->normalizeValue($value, $element);
        }

        return $value->getGeoJson();
    }

    public function isValueEmpty(mixed $value, ElementInterface $element): bool
    {
        return !$value instanceof Shape || $value->getIsEmpty();
    }

    public function getSettingsHtml(): ?string
    {
        return Craft::$app->getView()->renderTemplate('landmark/_field/settings.twig', [
            'field' => $this,
        ]);
    }

    protected function inputHtml(mixed $value, ?ElementInterface $element, bool $inline): string
    {
        $view = Craft::$app->getView();
        $view->registerAssetBundle(LandmarkFieldAsset::class);

        $id = $this->getInputId();
        $settings = Plugin::getInstance()->getSettings();

        $config = [
            'name' => $this->handle,
            'geometry' => $value instanceof Shape ? $value->geometry : null,
            'shapes' => $this->shapes,
            'allowMultiple' => $this->allowMultiple,
            'basemapUrl' => $settings->tileUrl(),
            'basemapAttribution' => $settings->attribution(),
            'hasSatellite' => $settings->resolvedGoogleApiKey() !== null,
            'centre' => [
                $this->defaultLat ?? $settings->defaultLat,
                $this->defaultLng ?? $settings->defaultLng,
            ],
            'zoom' => $this->defaultZoom ?? $settings->defaultZoom,
            'context' => $this->contextConfig($element),
            'icons' => [
                'code' => Cp::iconSvg('code'),
                'map' => Cp::iconSvg('map'),
                'layers' => Cp::iconSvg('layer-group'),
            ],
        ];

        $view->registerJs(sprintf(
            'new Landmark.Field(%s, %s);',
            Json::encode($view->namespaceInputId($id)),
            Json::encode($config)
        ));

        return $view->renderTemplate('landmark/_field/input.twig', [
            'id' => $id,
            'name' => $this->handle,
            'value' => $value,
            'field' => $this,
            'height' => $this->height ?? $settings->height,
        ]);
    }

    /**
     * What the editor needs to draw other entries' shapes behind this one.
     *
     * @return array<string, mixed>|null
     */
    private function contextConfig(?ElementInterface $element): ?array
    {
        if ($this->contextFields === []) {
            return null;
        }

        $fields = Craft::$app->getFields();
        $colours = ['#4299e1', '#f56565', '#48bb78', '#ed8936', '#9f7aea', '#38b2ac'];
        $sources = [];

        foreach ($this->contextFields as $i => $uid) {
            $field = $fields->getFieldByUid($uid);

            if ($field instanceof self) {
                $sources[] = [
                    'uid' => $uid,
                    'label' => $field->name,
                    'colour' => $colours[$i % count($colours)],
                ];
            }
        }

        if ($sources === []) {
            return null;
        }

        return [
            'sources' => $sources,
            'relation' => $this->relationConfig($element),
            'limit' => $this->contextLimit,
            // A draft and the entry it belongs to have different ids, and neither should show as another entry
            'exclude' => array_values(array_unique(array_filter([
                $element?->id,
                $element?->getCanonicalId(),
            ]))),
        ];
    }

    /**
     * The relation the context is filtered by, and what this entry is related to.
     *
     * @return array<string, mixed>|null
     */
    private function relationConfig(?ElementInterface $element): ?array
    {
        if ($this->contextRelation === null || $this->contextRelation === '') {
            return null;
        }

        $field = Craft::$app->getFields()->getFieldByUid($this->contextRelation);

        if ($field === null) {
            return null;
        }

        $selected = [];

        // A field can be renamed per layout, so the entry's own instance is found by uid
        // and read by the handle that layout gives it
        $instance = null;

        foreach ($element?->getFieldLayout()?->getCustomFields() ?? [] as $layoutField) {
            if ($layoutField->uid === $field->uid) {
                $instance = $layoutField;
                break;
            }
        }

        if ($instance !== null) {
            $value = $element->getFieldValue($instance->handle);
            $selected = $value instanceof ElementQueryInterface ? $value->ids() : [];
        }

        return [
            'uid' => $this->contextRelation,
            'label' => $field->name,
            'selected' => $selected,
        ];
    }

    /** @return array<string, bool> */
    public function drawOptions(): array
    {
        return [
            'drawMarker' => in_array('marker', $this->shapes, true),
            'drawPolyline' => in_array('line', $this->shapes, true),
            'drawPolygon' => in_array('polygon', $this->shapes, true),
            'drawCircle' => false,
            'drawCircleMarker' => false,
            'drawRectangle' => false,
            'drawText' => false,
        ];
    }

    public function getElementValidationRules(): array
    {
        return [];
    }
}
