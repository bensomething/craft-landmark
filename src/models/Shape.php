<?php

namespace bensomething\landmark\models;

use craft\helpers\Json;
use Stringable;

/**
 * A field's value: GeoJSON geometry, plus the coordinate text templates can wrap themselves.
 */
class Shape implements Stringable
{
    /** @var array<string, mixed>|null */
    public ?array $geometry = null;

    /**
     * @param array<string, mixed>|null $geometry
     */
    public function __construct(?array $geometry = null)
    {
        $this->geometry = $this->isGeometry($geometry) ? $geometry : null;
    }

    public function getIsEmpty(): bool
    {
        return $this->geometry === null;
    }

    public function getType(): ?string
    {
        return $this->geometry['type'] ?? null;
    }

    /**
     * @param array<string, mixed> $properties
     * @return array<string, mixed>|null
     */
    public function feature(array $properties = []): ?array
    {
        if ($this->geometry === null) {
            return null;
        }

        return [
            'type' => 'Feature',
            'properties' => $properties,
            'geometry' => $this->geometry,
        ];
    }

    public function getGeoJson(): ?string
    {
        return $this->geometry !== null ? Json::encode($this->geometry) : null;
    }

    /**
     * The shapes in a collection, or just this one.
     *
     * @return array<int, array<string, mixed>>
     */
    public function getGeometries(): array
    {
        if ($this->geometry === null) {
            return [];
        }

        return $this->getType() === 'GeometryCollection'
            ? array_values($this->geometry['geometries'])
            : [$this->geometry];
    }

    /** Laid out over several lines, for the field's GeoJSON panel. */
    public function getPrettyGeoJson(): ?string
    {
        return $this->geometry !== null
            ? json_encode($this->geometry, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
            : null;
    }

    /**
     * Coordinates without their outer brackets, so a template can wrap them itself.
     */
    public function getCoordinates(): ?string
    {
        $coordinates = $this->geometry['coordinates'] ?? null;

        // A collection holds shapes of different kinds, so there is no single list of points
        if ($coordinates === null) {
            return null;
        }

        return match ($this->getType()) {
            'Polygon' => $this->inner(Json::encode($coordinates[0] ?? [])),
            'MultiPolygon', 'MultiLineString' => $this->inner(Json::encode($coordinates)),
            'LineString' => $this->inner(Json::encode($coordinates)),
            'Point' => implode(', ', array_map(fn($n) => (string)$n, $coordinates)),
            default => null,
        };
    }

    public function getLat(): ?float
    {
        return $this->getType() === 'Point' ? ($this->geometry['coordinates'][1] ?? null) : null;
    }

    public function getLng(): ?float
    {
        return $this->getType() === 'Point' ? ($this->geometry['coordinates'][0] ?? null) : null;
    }

    public function __toString(): string
    {
        return $this->getCoordinates() ?? '';
    }

    private function inner(string $json): string
    {
        return substr($json, 1, -1);
    }

    /** @param array<string, mixed>|null $geometry */
    private function isGeometry(?array $geometry): bool
    {
        if (!isset($geometry['type']) || !is_string($geometry['type'])) {
            return false;
        }

        $points = $geometry['type'] === 'GeometryCollection'
            ? ($geometry['geometries'] ?? null)
            : ($geometry['coordinates'] ?? null);

        return is_array($points) && $points !== [];
    }
}
