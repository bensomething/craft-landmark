<?php

namespace bensomething\landmark\controllers;

use bensomething\landmark\fields\Map as MapField;
use bensomething\landmark\models\Shape;
use Craft;
use craft\db\Query;
use craft\db\Table;
use craft\elements\Entry;
use craft\web\Controller;
use yii\web\Response;

/**
 * Shapes from other entries, drawn behind the one being edited.
 */
class ContextController extends Controller
{
    public function actionShapes(): Response
    {
        $this->requireAcceptsJson();
        $this->requireCpRequest();

        $request = $this->request;
        $uids = (array)$request->getBodyParam('sources', []);
        $relationUids = array_filter((array)$request->getBodyParam('relations', []));
        $related = array_filter(array_map('intval', (array)$request->getBodyParam('related', [])));
        $exclude = array_map('intval', (array)$request->getBodyParam('exclude', []));
        // The field being edited, so only its own shape is left out of the entry's
        $instance = (string)$request->getBodyParam('instance', '');
        $limit = min((int)$request->getBodyParam('limit', 250) ?: 250, 2000);

        $fields = Craft::$app->getFields();
        $relationIds = [];

        // Every relation counts, as other entries may relate through a different one to this entry
        foreach ($relationUids as $relationUid) {
            if ($relation = $fields->getFieldByUid($relationUid)) {
                $relationIds[] = $relation->id;
            }
        }

        $elements = Craft::$app->getElements();
        $features = [];

        foreach ($uids as $uid) {
            [$fieldUid] = array_pad(explode(':', (string)$uid, 2), 2, null);
            $seen = [];

            // A query for each handle the field goes by, as a layout can give it one of its own
            foreach (MapField::sourceQueries((string)$uid, $uids) as $query) {
                $query->limit($limit);
                $queries = [$query];

                if ($relationIds !== [] && $related !== []) {
                    // What the others relate to counts as well, such as the year's own entry,
                    // which holds shapes of its own but relates to itself through nothing
                    $queries[] = (clone $query)->id($related);
                    // By id, since a handle can belong to more than one field across layouts
                    $query->relatedTo(['targetElement' => $related, 'field' => $relationIds]);
                }

                foreach (array_merge(...array_map(fn($each) => $each->all(), $queries)) as $entry) {
                    $editing = in_array($entry->id, $exclude, true) || in_array($entry->getCanonicalId(), $exclude, true);

                    if (!$elements->canView($entry)) {
                        continue;
                    }

                    // A layout can hold the same field more than once, and each of those is drawn
                    foreach (MapField::valuesOn($entry, (string)$fieldUid) as $handle => $value) {
                        // The entry being edited shows every shape but the one in the field itself
                        if ($editing && ($instance === '' || $handle === $instance)) {
                            continue;
                        }

                        if ($value->getIsEmpty() || isset($seen["$entry->id:$handle"])) {
                            continue;
                        }

                        $seen["$entry->id:$handle"] = true;
                        $features[] = $value->feature([
                            'source' => $uid,
                            'title' => $entry->title,
                            'id' => $entry->id,
                            'siteId' => $entry->siteId,
                        ]);
                    }
                }
            }
        }

        return $this->asJson(['features' => $features]);
    }

    /**
     * What a relation can be filtered by, for the editor's picker.
     */
    public function actionOptions(): Response
    {
        $this->requireAcceptsJson();
        $this->requireCpRequest();

        $fieldIds = [];

        foreach (array_filter((array)$this->request->getBodyParam('relations', [])) as $uid) {
            if ($field = Craft::$app->getFields()->getFieldByUid($uid)) {
                $fieldIds[] = $field->id;
            }
        }

        if ($fieldIds === []) {
            return $this->asJson(['options' => []]);
        }

        // What this field actually relates to across the site. Asking the field itself
        // gives an empty query, since there is no element to read a value from.
        $targets = (new Query())
            ->select(['targetId'])
            ->distinct()
            ->from(Table::RELATIONS)
            ->where(['fieldId' => $fieldIds])
            ->limit(500)
            ->column();

        if ($targets === []) {
            return $this->asJson(['options' => []]);
        }

        $options = array_map(
            fn($element) => ['id' => $element->id, 'title' => (string)$element],
            Entry::find()->id($targets)->status(null)->orderBy(['title' => SORT_DESC])->limit(200)->all()
        );

        return $this->asJson(['options' => $options]);
    }
}
