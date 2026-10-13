import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BriefV2Schema,
  EntitySchema,
  MapLayerSchema,
  ProposalSchema,
  SimulationResultSchema,
} from '@tastedraft/contracts';

const entity = {
  id: 'td-mock-entity-velvet-circuit',
  name: 'Velvet Circuit',
  type: 'urn:entity:brand',
  image: 'https://example.invalid/tastedraft-mock/velvet-circuit.png',
  city: 'Los Angeles',
  geo: { lat: 34.08, lng: -118.26 },
  source: 'mock',
};

describe('@tastedraft/contracts', () => {
  it('parses a simulation the server and the frontend can share', () => {
    const result = SimulationResultSchema.parse({
      id: 'sim-wave0',
      mode: 'mock',
      brief: {
        idea: 'A paper-cut clothing label with a night-grid soundtrack',
        interests: [{ id: 'td-mock-tag-paper-cut', name: 'paper-cut minimal', type: 'urn:tag:td-mock' }],
        references: [entity],
        locations: [{
          id: 'td-mock-entity-lantern-row',
          name: 'Lantern Row',
          type: 'urn:entity:place',
          city: 'Los Angeles',
          geo: { lat: 34.0912, lng: -118.2718 },
          source: 'mock',
        }],
        city: 'Los Angeles',
        age: '18–25',
        gender: 'female',
        priceLevel: 3,
        positioning: 'Premium',
        constraints: ['Keep the city'],
      },
      signals: [{
        id: 'td-mock-entity-velvet-circuit',
        name: 'Velvet Circuit',
        type: 'urn:entity:brand',
        affinity: 0.62,
        source: 'mock:/v2/insights',
        params: { 'signal.demographics.age': '24_and_younger' },
      }],
      explainability: [{
        input: 'td-mock-entity-northwind-audio',
        weight: 0.44,
        target: 'td-mock-entity-velvet-circuit',
      }],
      ledger: {
        total: null,
        rows: [{
          id: 'anchor',
          subscore: null,
          weight: 30,
          points: null,
          provenance: {
            source: 'mock:/v2/insights',
            detail: 'No live affinity was measured.',
            evidenceRefs: ['td-mock-entity-velvet-circuit'],
          },
        }],
      },
      proposals: [{
        id: 'proposal-age',
        changes: [{ param: 'signal.demographics.age', from: '24_and_younger', to: '25_to_29' }],
        why: 'The next age bucket is the closest measured neighbor.',
        evidenceRefs: ['td-mock-entity-velvet-circuit'],
        predictedDelta: 4,
      }],
      layers: [
        {
          kind: 'heatmap',
          id: 'layer-heat',
          name: 'Lantern Row heat',
          cells: [{ id: 'td-mock-cell-lantern-row', lat: 34.0912, lng: -118.2718, weight: 0.58, label: 'Lantern Row' }],
        },
        {
          kind: 'pins',
          id: 'layer-pins',
          name: 'References',
          pins: [{ id: 'pin-velvet', name: 'Velvet Circuit', lat: 34.08, lng: -118.26, entityId: entity.id }],
        },
      ],
    });
    assert.equal(result.brief.priceLevel, 3);
    assert.equal(result.layers[0]?.kind, 'heatmap');
    assert.equal(result.layers[1]?.kind, 'pins');
    assert.equal(result.proposals[0]?.changes[0]?.param, 'signal.demographics.age');
  });

  it('rejects an entity with no source and a proposal param that is not dotted', () => {
    assert.equal(EntitySchema.safeParse({ id: 'x', name: 'X', type: 'urn:entity:brand' }).success, false);
    assert.equal(ProposalSchema.safeParse({
      id: 'p',
      changes: [{ param: 'take', from: null, to: '10' }],
      why: 'because',
      evidenceRefs: ['x'],
    }).success, false);
    assert.equal(BriefV2Schema.safeParse({
      idea: 'x',
      interests: [],
      references: [],
      locations: [],
      city: 'Los Angeles',
      age: '18–25',
      priceLevel: 5,
      positioning: 'Premium',
      constraints: [],
    }).success, false);
    const layer = MapLayerSchema.safeParse({ kind: 'heatmap', id: 'h', name: 'H', pins: [] });
    assert.equal(layer.success, false);
  });
});
