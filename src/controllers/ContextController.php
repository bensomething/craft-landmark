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

                if ($relationIds !== [] && $related !== []) {
                    // By id, since a handle can belong to more than one field across layouts
                    $query->relatedTo(['targetElement' => $related, 'field' => $relationIds]);
                }

                foreach ($query->all() as $entry) {
                    if (in_array($entry->id, $exclude, true) || in_array($entry->getCanonicalId(), $exclude, true)) {
                        continue;
                    }

                    if (isset($seen[$entry->id]) || !$elements->canView($entry)) {
                        continue;
                    }

                    $value = MapField::valueOn($entry, (string)$fieldUid);

                    if (!$value instanceof Shape || $value->getIsEmpty()) {
                        continue;
                    }

                    $seen[$entry->id] = true;
                    $features[] = $value->feature([
                        'source' => $uid,
                        'title' => $entry->title,
                        'id' => $entry->id,
                        'siteId' => $entry->siteId,
                    ]);
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
