'use strict';

// rule-engine.js is written as a browser IIFE that attaches itself to
// `window`. Stub out a minimal `window` before requiring it so it can run
// unmodified under plain Node (no build step, no test framework deps).
global.window = global.window || {};
require('./rule-engine.js');
const RuleEngine = global.window.RuleEngine;

const test = require('node:test');
const assert = require('node:assert/strict');

test('getPathFor', async (t) => {
    await t.test('overrides group to ticket.assignee.group.id (group is nested under assignee in ZAF, not a top-level ticket.group)', () => {
        assert.equal(RuleEngine.getPathFor('group'), 'ticket.assignee.group.id');
    });

    await t.test('overrides assignee to ticket.assignee.user.id', () => {
        assert.equal(RuleEngine.getPathFor('assignee'), 'ticket.assignee.user.id');
    });

    await t.test('routes custom fields through ticket.customField:', () => {
        assert.equal(RuleEngine.getPathFor('custom_field_123'), 'ticket.customField:custom_field_123');
    });

    await t.test('falls back to ticket.<key> for plain standard fields', () => {
        assert.equal(RuleEngine.getPathFor('priority'), 'ticket.priority');
        assert.equal(RuleEngine.getPathFor('subject'), 'ticket.subject');
    });
});

test('isEmpty', async (t) => {
    await t.test('null and undefined are empty', () => {
        assert.equal(RuleEngine.isEmpty(null), true);
        assert.equal(RuleEngine.isEmpty(undefined), true);
    });

    await t.test('blank and whitespace-only strings are empty', () => {
        assert.equal(RuleEngine.isEmpty(''), true);
        assert.equal(RuleEngine.isEmpty('   '), true);
    });

    await t.test('a non-blank string is not empty', () => {
        assert.equal(RuleEngine.isEmpty('resolved the issue'), false);
    });

    await t.test('an empty array is empty, a populated one is not', () => {
        assert.equal(RuleEngine.isEmpty([]), true);
        assert.equal(RuleEngine.isEmpty(['tag']), false);
    });

    await t.test('0 and false are not empty (only null/undefined/blank/[] are)', () => {
        assert.equal(RuleEngine.isEmpty(0), false);
        assert.equal(RuleEngine.isEmpty(false), false);
    });
});

test('matchesGroup', async (t) => {
    await t.test('a rule with no groupId matches any ticket group (unrestricted)', () => {
        assert.equal(RuleEngine.matchesGroup({ groupId: '' }, '123'), true);
        assert.equal(RuleEngine.matchesGroup({}, '123'), true);
        assert.equal(RuleEngine.matchesGroup({ groupId: '' }, undefined), true);
    });

    await t.test('a rule with a groupId matches only that group', () => {
        assert.equal(RuleEngine.matchesGroup({ groupId: '123' }, '123'), true);
        assert.equal(RuleEngine.matchesGroup({ groupId: '123' }, '456'), false);
    });

    await t.test('group ids are compared as strings (number vs string agreement)', () => {
        assert.equal(RuleEngine.matchesGroup({ groupId: '123' }, 123), true);
        assert.equal(RuleEngine.matchesGroup({ groupId: 123 }, '123'), true);
    });
});

test('getFieldActionCalls', async (t) => {
    await t.test('maps matching hide and disable rules to field actions and ignores require', () => {
        assert.deepEqual(RuleEngine.getFieldActionCalls([
            { fieldKey: 'subject', action: 'hide', triggerStatus: 'open' },
            { fieldKey: 'priority', action: 'disable', triggerStatus: 'open' },
            { fieldKey: 'description', action: 'require', triggerStatus: 'open' }
        ], 'open', '42'), {
            'ticketFields:subject.hide': [],
            'ticketFields:priority.disable': []
        });
    });

    await t.test('restores fields when status or group conditions do not match', () => {
        assert.deepEqual(RuleEngine.getFieldActionCalls([
            { fieldKey: 'subject', action: 'hide', triggerStatus: 'pending' },
            { fieldKey: 'priority', action: 'disable', triggerStatus: 'open', groupId: '99' }
        ], 'open', '42'), {
            'ticketFields:subject.show': [],
            'ticketFields:priority.enable': []
        });
    });
});

test('currentStatus / currentGroupId read the right client.get() path', async (t) => {
    await t.test('currentStatus reads ticket.status', async () => {
        const client = { get: async (path) => ({ [path]: 'solved' }) };
        assert.equal(await RuleEngine.currentStatus(client), 'solved');
    });

    await t.test('currentGroupId reads ticket.assignee.group.id (a ticket group is nested under assignee in ZAF; there is no top-level ticket.group get path)', async () => {
        const client = { get: async (path) => ({ [path]: '789' }) };
        assert.equal(await RuleEngine.currentGroupId(client), '789');
    });
});

test('loadRules', async (t) => {
    await t.test('parses a valid stored config array', async () => {
        const client = { metadata: async () => ({ settings: { field_rules_config: '[{"id":"r1"}]' } }) };
        assert.deepEqual(await RuleEngine.loadRules(client), [{ id: 'r1' }]);
    });

    await t.test('falls back to [] when the stored config is missing or invalid JSON', async () => {
        const missing = { metadata: async () => ({ settings: {} }) };
        assert.deepEqual(await RuleEngine.loadRules(missing), []);

        const invalid = { metadata: async () => ({ settings: { field_rules_config: '{not json' } }) };
        assert.deepEqual(await RuleEngine.loadRules(invalid), []);
    });

    await t.test('falls back to [] when the stored config parses to a non-array', async () => {
        const client = { metadata: async () => ({ settings: { field_rules_config: '{"oops":true}' } }) };
        assert.deepEqual(await RuleEngine.loadRules(client), []);
    });
});

test('regression: group-restricted rule matching against a ZAF-shaped client', async (t) => {
    await t.test('currentGroupId + matchesGroup correctly block when the ticket is in the restricted group', async () => {
        // Mimics a real ZAF client: only recognizes the documented
        // ticket.assignee.group.id path, throws on anything else (e.g. the
        // old, wrong "ticket.group.id" path), the way a strict/real client would.
        const zafLikeClient = {
            get: async (path) => {
                if (path !== 'ticket.assignee.group.id') {
                    throw new Error(`unsupported get() path: ${path}`);
                }
                return { 'ticket.assignee.group.id': '42' };
            }
        };
        const groupId = await RuleEngine.currentGroupId(zafLikeClient);
        assert.equal(groupId, '42');
        assert.equal(RuleEngine.matchesGroup({ groupId: '42' }, groupId), true);
        assert.equal(RuleEngine.matchesGroup({ groupId: '99' }, groupId), false);
    });
});
