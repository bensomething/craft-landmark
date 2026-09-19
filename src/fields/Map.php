<?php

namespace bensomething\landmark\fields;

use bensomething\landmark\models\Settings;
use bensomething\landmark\models\Shape;
use bensomething\landmark\Plugin;
use bensomething\landmark\web\assets\field\LandmarkFieldAsset;
use Craft;
use craft\base\ElementInterface;
use craft\base\Field;
use craft\elements\db\ElementQueryInterface;
use craft\elements\db\EntryQuery;
use craft\elements\Entry;
use craft\fields\Matrix;
use craft\models\FieldLayout;
use craft\validators\ColorValidator;
use craft\helpers\Cp;
use craft\helpers\Json;
use yii\db\Schema;

class Map extends Field
{
    /** @var string[] Any of 'marker', 'line', 'polygon', 'rectangle', 'circle', 'dot', 'text' */
    public array $shapes = ['polygon'];

    public bool $allowMultiple = false;

    /** Whether this field picks its own toolbar buttons rather than the plugin's. */
    public bool $ownEditingTools = false;

    /** @var string[] This field's own Geoman toolbar buttons, used when it picks its own. */
    public array $editingTools = ['edit', 'drag', 'remove', 'rotate'];

    /** Null falls back to the plugin's settings. */
    public ?float $defaultLat = null;
    public ?float $defaultLng = null;
    public ?int $defaultZoom = null;

    public ?int $height = null;

    /**
     * @var string[] Sources of shapes drawn behind this field's own: a Landmark field's UID, or
     * `fieldUid:sectionUid` for only that field's entries in one section.
     */
    public array $contextFields = [];

    /** @var array<string, string> A colour for each source, by its UID. A source without one takes the next in the palette. */
    public array $contextColours = [];

    /**
     * @var string[] UIDs of relation fields entries can share, so only matching entries are shown.
     * An entry matches on whichever of these its own layout has.
     */
    public array $contextRelations = [];

    public int $contextLimit = 250;

    public function __construct(array $config = [])
    {
        // Saved before a field could match on more than one relation
        if (array_key_exists('contextRelation', $config)) {
            $old = $config['contextRelation'];
            unset($config['contextRelation']);

            if (!isset($config['contextRelations']) && is_string($old) && $old !== '') {
                $config['contextRelations'] = [$old];
            }
        }

        // An empty checkbox list posts an empty string
        foreach (['contextFields', 'contextRelations', 'editingTools'] as $key) {
            if (array_key_exists($key, $config)) {
                $config[$key] = array_values(array_filter((array)$config[$key]));
            }
        }

        // Craft's colour input posts hex without its #, and a blank one falls back to the palette
        if (array_key_exists('contextColours', $config)) {
            $colours = [];

            foreach (is_array($config['contextColours']) ? $config['contextColours'] : [] as $source => $colour) {
                $colour = is_string($colour) ? trim($colour) : '';

                if ($colour !== '' && preg_match('/^#[0-9a-f]{6}$/', $colour = ColorValidator::normalizeColor($colour))) {
                    $colours[$source] = $colour;
                }
            }

            $config['contextColours'] = $colours;
        }

        parent::__construct($config);
    }

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
            [['editingTools'], 'each', 'rule' => ['in', 'range' => array_keys(Settings::EDITING_TOOLS)]],
        ]);
    }

    /**
     * Every handle a field goes by, since a layout can give it one of its own. An entry only
     * answers to the handle its own layout uses.
     *
     * @return string[]
     */
    public static function handlesFor(string $fieldUid, string $fallback): array
    {
        $handles = [$fallback];

        foreach (Craft::$app->getEntries()->getAllEntryTypes() as $entryType) {
            foreach ($entryType->getFieldLayout()?->getCustomFields() ?? [] as $layoutField) {
                if ($layoutField->uid === $fieldUid) {
                    $handles[] = $layoutField->handle;
                }
            }
        }

        return array_values(array_unique($handles));
    }

    /**
     * What a field holds on one entry, read by the handle that entry's own layout gives it. A
     * layout can use the same field more than once, such as a fence and a boundary drawn on one
     * entry, and each of those is kept under a handle of its own.
     *
     * @return array<string, Shape> the handle each value is held under
     */
    public static function valuesOn(ElementInterface $element, string $fieldUid): array
    {
        $values = [];

        foreach ($element->getFieldLayout()?->getCustomFields() ?? [] as $layoutField) {
            if ($layoutField->uid === $fieldUid) {
                $value = $element->getFieldValue($layoutField->handle);

                if ($value instanceof Shape) {
                    $values[$layoutField->handle] = $value;
                }
            }
        }

        return $values;
    }

    /**
     * The entries with shapes for one source, a query for each handle the field goes by. A whole
     * field leaves out the sections that have a source of their own, so no shape is drawn twice.
     *
     * @param string[] $sources every source being drawn
     * @return array<int, EntryQuery>
     */
    public static function sourceQueries(string $source, array $sources): array
    {
        [$fieldUid, $sectionUid] = array_pad(explode(':', $source, 2), 2, null);
        $field = Craft::$app->getFields()->getFieldByUid($fieldUid);

        if (!$field instanceof self) {
            return [];
        }

        $sections = Craft::$app->getEntries();
        $split = [];

        if ($sectionUid === null) {
            foreach ($sources as $other) {
                [$otherField, $otherSection] = array_pad(explode(':', (string)$other, 2), 2, null);

                if ($otherField === $fieldUid && $otherSection !== null && ($section = $sections->getSectionByUid($otherSection))) {
                    $split[] = $section->id;
                }
            }
        } elseif (($section = $sections->getSectionByUid($sectionUid)) === null) {
            return [];
        }

        $queries = [];

        foreach (self::handlesFor((string)$fieldUid, $field->handle) as $handle) {
            $query = Entry::find()->status('live')->$handle(':notempty:');

            if ($sectionUid !== null) {
                $query->andWhere(self::inSections([$section->id]));
            } elseif ($split !== []) {
                $query->andWhere(['not', self::inSections($split)]);
            }

            $queries[] = $query;
        }

        return $queries;
    }

    /**
     * Entries in these sections, or nested in an entry that is. Each side rules out NULL itself,
     * since nested entries have no section and top-level entries no owner, and a NULL would
     * otherwise drop rows when the condition is negated.
     *
     * @param int[] $sectionIds
     */
    private static function inSections(array $sectionIds): array
    {
        $owners = Entry::find()->sectionId($sectionIds)->status(null)->ids();

        return ['or',
            ['and', ['not', ['entries.sectionId' => null]], ['entries.sectionId' => $sectionIds]],
            ['and', ['not', ['entries.primaryOwnerId' => null]], ['entries.primaryOwnerId' => $owners ?: [0]]],
        ];
    }

    /**
     * What the field settings offer to draw behind: each Landmark field, and each section using it.
     *
     * @return array<int, array{label: string, value: string}>
     */
    private function contextSourceOptions(): array
    {
        $options = [];

        foreach (Craft::$app->getFields()->getFieldsByType(self::class) as $field) {
            $name = sprintf('%s (%s)', $field->name, $field->handle);
            $options[] = ['label' => $name, 'value' => $field->uid];

            foreach (Craft::$app->getEntries()->getAllSections() as $section) {
                foreach ($section->getEntryTypes() as $entryType) {
                    if (self::layoutUses($entryType->getFieldLayout(), $field->uid)) {
                        $options[] = ['label' => "$name in $section->name", 'value' => "$field->uid:$section->uid"];
                        continue 2;
                    }
                }
            }
        }

        return $options;
    }

    /** Whether a layout has the field, directly or in the entries of a Matrix field it has. */
    private static function layoutUses(?FieldLayout $layout, string $uid, int $depth = 0): bool
    {
        foreach ($layout?->getCustomFields() ?? [] as $field) {
            if ($field->uid === $uid) {
                return true;
            }

            if ($depth < 2 && $field instanceof Matrix) {
                foreach ($field->getEntryTypes() as $entryType) {
                    if (self::layoutUses($entryType->getFieldLayout(), $uid, $depth + 1)) {
                        return true;
                    }
                }
            }
        }

        return false;
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
            'sourceOptions' => $this->contextSourceOptions(),
            'toolOptions' => self::editingToolOptions(),
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
            'editingTools' => $this->ownEditingTools ? $this->editingTools : $settings->editingTools,
            'basemapUrl' => $settings->tileUrl(),
            'basemapAttribution' => $settings->attribution(),
            'hasSatellite' => $settings->resolvedGoogleApiKey() !== null,
            'esriImagery' => $settings->esriImagery,
            'centre' => [
                $this->defaultLat ?? $settings->defaultLat,
                $this->defaultLng ?? $settings->defaultLng,
            ],
            'zoom' => $this->defaultZoom ?? $settings->defaultZoom,
            'opacity' => $settings->shapeOpacity,
            'context' => $this->contextConfig($element),
            'icons' => [
                'code' => Cp::iconSvg('brackets-curly'),
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
        $sources = $this->contextSources();

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
     * The sources this field draws behind its own, each with a label and colour.
     *
     * @return array<int, array{uid: string, label: string, colour: string}>
     */
    public function contextSources(): array
    {
        $fields = Craft::$app->getFields();
        $colours = ['#4299e1', '#f56565', '#48bb78', '#ed8936', '#9f7aea', '#38b2ac'];
        $sources = [];

        foreach ($this->contextFields as $i => $uid) {
            [$fieldUid, $sectionUid] = array_pad(explode(':', $uid, 2), 2, null);
            $field = $fields->getFieldByUid($fieldUid);
            $section = $sectionUid !== null ? Craft::$app->getEntries()->getSectionByUid($sectionUid) : null;

            if ($field instanceof self && ($sectionUid === null || $section !== null)) {
                $sources[] = [
                    'uid' => $uid,
                    // A section's own shapes are named for the section
                    'label' => $section->name ?? $field->name,
                    'colour' => $this->contextColours[$uid] ?? $colours[$i % count($colours)],
                ];
            }
        }

        return $sources;
    }

    /**
     * The relation the context is filtered by, and what this entry is related to.
     *
     * @return array<string, mixed>|null
     */
    private function relationConfig(?ElementInterface $element): ?array
    {
        if ($this->contextRelations === []) {
            return null;
        }

        // A field can be renamed per layout, so the entry's own instance is found by uid
        // and read by the handle that layout gives it
        $instance = null;

        foreach ($element?->getFieldLayout()?->getCustomFields() ?? [] as $layoutField) {
            if (in_array($layoutField->uid, $this->contextRelations, true)) {
                $instance = $layoutField;
                break;
            }
        }

        // With none of the relations in its layout, an entry has nothing to match on
        if ($instance === null) {
            return null;
        }

        $selected = [];
        $options = [];
        $value = $element->getFieldValue($instance->handle);

        if ($value instanceof ElementQueryInterface) {
            // Only what this entry is related to, so a block can't sit on a year it isn't in
            foreach ($value->limit(200)->all() as $related) {
                $selected[] = $related->id;
                $options[] = ['id' => $related->id, 'title' => (string)$related];
            }
        }

        return [
            'uid' => $instance->uid,
            'fields' => $this->contextRelations,
            'label' => $instance->name,
            'selected' => $selected,
            'options' => $options,
        ];
    }

    /**
     * The Geoman toolbar buttons a field or the plugin can show.
     *
     * @return array<int, array{label: string, value: string}>
     */
    public static function editingToolOptions(): array
    {
        $options = [];

        foreach (Settings::EDITING_TOOLS as $value => $label) {
            $options[] = ['label' => Craft::t('landmark', $label), 'value' => $value];
        }

        return $options;
    }

    /** @return array<string, bool> */
    public function drawOptions(): array
    {
        return [
            'drawMarker' => in_array('marker', $this->shapes, true),
            'drawPolyline' => in_array('line', $this->shapes, true),
            'drawPolygon' => in_array('polygon', $this->shapes, true),
            'drawRectangle' => in_array('rectangle', $this->shapes, true),
            'drawCircle' => in_array('circle', $this->shapes, true),
            'drawText' => in_array('text', $this->shapes, true),
            'drawCircleMarker' => in_array('dot', $this->shapes, true),
        ];
    }

    public function getElementValidationRules(): array
    {
        return [];
    }
}
