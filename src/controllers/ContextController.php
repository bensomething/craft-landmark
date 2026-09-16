<?php

namespace bensomething\landmark\controllers;

use bensomething\landmark\fields\Map as MapField;
use bensomething\landmark\models\Shape;
use Craft;
use craft\elements\db\ElementQueryInterface;
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
        $relationUid = $request->getBodyParam('relation');
        $related = array_filter(array_map('intval', (array)$request->getBodyParam('related', [])));
        $exclude = array_map('intval', (array)$request->getBodyParam('exclude', []));
        $limit = min((int)$request->getBodyParam('limit', 250) ?: 250, 2000);

        $fields = Craft::$app->getFields();
        $relation = $relationUid ? $fields->getFieldByUid($relationUid) : null;
        $features = [];

        foreach ($uids as $uid) {
            $field = $fields->getFieldByUid($uid);

            if (!$field instanceof MapField) {
                continue;
            }

            $handle = $field->handle;
            $query = Entry::find()
                ->status('live')
                ->limit($limit)
                ->$handle(':notempty:');

            if ($relation !== null && $related !== []) {
                // By id, since a handle can belong to more than one field across layouts
                $query->relatedTo(['targetElement' => $related, 'field' => $relation->id]);
            }

            foreach ($query->all() as $entry) {
                if (in_array($entry->id, $exclude, true) || in_array($entry->getCanonicalId(), $exclude, true)) {
                    continue;
                }

                $value = $entry->getFieldValue($handle);

                if (!$value instanceof Shape || $value->getIsEmpty()) {
                    continue;
                }

                $features[] = $value->feature([
                    'source' => $uid,
                    'title' => $entry->title,
                ]);
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

        $field = Craft::$app->getFields()->getFieldByUid((string)$this->request->getBodyParam('relation'));

        if ($field === null) {
            return $this->asJson(['options' => []]);
        }

        $query = $field->normalizeValue(null, null);

        if (!$query instanceof ElementQueryInterface) {
            return $this->asJson(['options' => []]);
        }

        $options = array_map(
            fn($element) => ['id' => $element->id, 'title' => (string)$element],
            $query->status('live')->limit(200)->all()
        );

        return $this->asJson(['options' => $options]);
    }
}
