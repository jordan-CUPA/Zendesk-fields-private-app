/**
 * Shared helpers for the Dynamic Field Manager rule engine.
 * Loaded by assets/sidebar.html for field actions and save-time blocking,
 * keeping both behaviors aligned on how rules are interpreted.
 */
(function (global) {
    // client.get() paths for standard fields that aren't just "ticket.<key>".
    // NOTE: a ticket's group is NOT a top-level "ticket.group" property in the
    // ZAF data model - the Support API docs define "assignee" as "a
    // composition of user (an agent) and his or her group", so the group
    // lives under ticket.assignee.group (confirmed by the documented change
    // event "ticket.assignee.group.id.changed" - there is no
    // "ticket.group.changed").
    const GET_PATH_OVERRIDES = {
        group: 'ticket.assignee.group.id',
        assignee: 'ticket.assignee.user.id'
    };

    function getPathFor(fieldKey) {
        if (fieldKey.startsWith('custom_field_')) {
            return `ticket.customField:${fieldKey}`;
        }
        return GET_PATH_OVERRIDES[fieldKey] || `ticket.${fieldKey}`;
    }

    async function loadRules(client) {
        try {
            const metadata = await client.metadata();
            const parsed = JSON.parse(metadata.settings.field_rules_config || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.error('Failed to parse field_rules_config.', e);
            return [];
        }
    }

    async function currentStatus(client) {
        const data = await client.get('ticket.status');
        return data['ticket.status'];
    }

    async function currentGroupId(client) {
        const data = await client.get('ticket.assignee.group.id');
        return data['ticket.assignee.group.id'];
    }

    function isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'string') return value.trim() === '';
        return false;
    }

    // A rule with no groupId is unrestricted (applies regardless of the
    // ticket's group), mirroring Zendesk's own "group restrictions" default
    // of unrestricted-unless-opted-in. Ids are compared as strings since
    // client.get() and the REST API don't consistently agree on number vs
    // string for group ids.
    function matchesGroup(rule, ticketGroupId) {
        if (!rule.groupId) return true;
        return String(rule.groupId) === String(ticketGroupId);
    }

    function getFieldActionCalls(rules, status, groupId) {
        const invokeCalls = {};
        rules.forEach(rule => {
            const matches = rule.triggerStatus === status && matchesGroup(rule, groupId);
            if (rule.action === 'hide') {
                invokeCalls[`ticketFields:${rule.fieldKey}.${matches ? 'hide' : 'show'}`] = [];
            } else if (rule.action === 'disable') {
                invokeCalls[`ticketFields:${rule.fieldKey}.${matches ? 'disable' : 'enable'}`] = [];
            }
        });
        return invokeCalls;
    }

    global.RuleEngine = {
        getPathFor,
        loadRules,
        currentStatus,
        currentGroupId,
        isEmpty,
        matchesGroup,
        getFieldActionCalls
    };
})(window);
