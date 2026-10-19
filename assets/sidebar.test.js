'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('./lib/rule-engine.js');
const RuleEngine = global.window.RuleEngine;

const sidebarHtml = fs.readFileSync(path.join(__dirname, 'sidebar.html'), 'utf8');
const inlineScript = sidebarHtml.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

function createHarness({ rules, status = 'open', groupId = '42' }) {
    const handlers = {};
    const invocations = [];
    const client = {
        on(event, handler) {
            handlers[event] = handler;
        },
        async invoke(...args) {
            invocations.push(JSON.parse(JSON.stringify(args)));
        }
    };
    const ruleEngine = {
        ...RuleEngine,
        loadRules: async () => rules,
        currentStatus: async () => typeof status === 'function' ? status() : status,
        currentGroupId: async () => typeof groupId === 'function' ? groupId() : groupId
    };

    vm.runInNewContext(inlineScript, {
        ZAFClient: { init: () => client },
        RuleEngine: ruleEngine,
        console: { error() {}, warn() {} },
        document: { getElementById: () => ({ textContent: '', className: '' }) }
    });

    return {
        handlers,
        invocations,
        async register() {
            await handlers['app.registered']();
        }
    };
}

test('sidebar hides and disables matching fields while leaving require to the save hook', async () => {
    const harness = createHarness({
        rules: [
            { fieldKey: 'custom_field_1234', action: 'hide', triggerStatus: 'open', groupId: '42' },
            { fieldKey: 'priority', action: 'disable', triggerStatus: 'open', groupId: '42' },
            { fieldKey: 'description', action: 'require', triggerStatus: 'open', groupId: '42' }
        ]
    });

    await harness.register();

    assert.deepEqual(harness.invocations, [[{
        'ticketFields:custom_field_1234.hide': [],
        'ticketFields:priority.disable': []
    }]]);
    assert.equal(typeof harness.handlers['ticket.save'], 'function');
});

test('sidebar shows and enables fields when status or group does not match', async () => {
    const harness = createHarness({
        rules: [
            { fieldKey: 'custom_field_1234', action: 'hide', triggerStatus: 'pending' },
            { fieldKey: 'priority', action: 'disable', triggerStatus: 'open', groupId: '99' }
        ]
    });

    await harness.register();

    assert.deepEqual(harness.invocations, [[{
        'ticketFields:custom_field_1234.show': [],
        'ticketFields:priority.enable': []
    }]]);
});

test('sidebar reevaluates field actions after status and group changes', async () => {
    let status = 'open';
    let groupId = '42';
    const harness = createHarness({
        rules: [
            { fieldKey: 'custom_field_1234', action: 'hide', triggerStatus: 'open', groupId: '42' }
        ],
        status: () => status,
        groupId: () => groupId
    });

    await harness.register();
    status = 'pending';
    await harness.handlers['ticket.status.changed']();
    status = 'open';
    groupId = '99';
    await harness.handlers['ticket.assignee.group.id.changed']();
    groupId = '42';
    await harness.handlers['ticket.assignee.group.id.changed']();

    assert.deepEqual(harness.invocations, [
        [{ 'ticketFields:custom_field_1234.hide': [] }],
        [{ 'ticketFields:custom_field_1234.show': [] }],
        [{ 'ticketFields:custom_field_1234.show': [] }],
        [{ 'ticketFields:custom_field_1234.hide': [] }]
    ]);
});