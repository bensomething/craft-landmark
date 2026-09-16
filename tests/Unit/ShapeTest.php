<?php

namespace bensomething\landmark\tests\Unit;

use bensomething\landmark\models\Shape;
use PHPUnit\Framework\TestCase;

class ShapeTest extends TestCase
{
    public function testEmptyWithoutGeometry(): void
    {
        $shape = new Shape();

        $this->assertTrue($shape->getIsEmpty());
        $this->assertNull($shape->getType());
        $this->assertNull($shape->getCoordinates());
        $this->assertNull($shape->getGeoJson());
        $this->assertSame('', (string)$shape);
    }

    public function testIgnoresMalformedGeometry(): void
    {
        $this->assertTrue((new Shape(['type' => 'Polygon']))->getIsEmpty());
        $this->assertTrue((new Shape(['coordinates' => [[1, 2]]]))->getIsEmpty());
        $this->assertTrue((new Shape(['type' => 'Polygon', 'coordinates' => []]))->getIsEmpty());
    }

    public function testPolygonReturnsItsRing(): void
    {
        $ring = [[-2.58, 51.14], [-2.57, 51.14], [-2.57, 51.15], [-2.58, 51.14]];
        $shape = new Shape(['type' => 'Polygon', 'coordinates' => [$ring]]);

        $this->assertSame('Polygon', $shape->getType());
        $this->assertSame('[-2.58,51.14],[-2.57,51.14],[-2.57,51.15],[-2.58,51.14]', $shape->getCoordinates());
    }

    public function testMultiPolygonKeepsItsRings(): void
    {
        $shape = new Shape([
            'type' => 'MultiPolygon',
            'coordinates' => [[[[-2.58, 51.14], [-2.57, 51.14], [-2.58, 51.14]]]],
        ]);

        $this->assertSame('[[[-2.58,51.14],[-2.57,51.14],[-2.58,51.14]]]', $shape->getCoordinates());
    }

    public function testPointExposesLatAndLng(): void
    {
        $shape = new Shape(['type' => 'Point', 'coordinates' => [-2.58, 51.14]]);

        $this->assertSame(51.14, $shape->getLat());
        $this->assertSame(-2.58, $shape->getLng());
        $this->assertSame('-2.58, 51.14', $shape->getCoordinates());
    }

    public function testLatAndLngAreNullForShapes(): void
    {
        $shape = new Shape(['type' => 'Polygon', 'coordinates' => [[[-2.58, 51.14], [-2.57, 51.14]]]]);

        $this->assertNull($shape->getLat());
        $this->assertNull($shape->getLng());
    }

    public function testFeatureWrapsGeometryWithProperties(): void
    {
        $geometry = ['type' => 'Point', 'coordinates' => [-2.58, 51.14]];
        $feature = (new Shape($geometry))->feature(['name' => 'Pyramid Stage']);

        $this->assertSame([
            'type' => 'Feature',
            'properties' => ['name' => 'Pyramid Stage'],
            'geometry' => $geometry,
        ], $feature);

        $this->assertNull((new Shape())->feature());
    }
}
