const Sequelize = require('sequelize'),
    uuid = require('uuid'),
    httpContext = require('express-http-context');


const { CONTEXT_ID, WEBHOOKS_EVENTS_TABLE_NAME, WEBHOOKS_TABLE_NAME, WEBHOOKS_EVENTS_MAPPING_TABLE_NAME } = require('../../../../database/sequlize-handler/consts');

let client;

module.exports = {
    init,
    getAllWebhooks,
    createWebhook,
    getWebhook,
    updateWebhook,
    deleteWebhook,
    getAllGlobalWebhooks
};

function parseWebhook(webhookRecord) {
    return webhookRecord && {
        ...webhookRecord.dataValues,
        events: webhookRecord.events && webhookRecord.events.map(eventRecord => eventRecord.dataValues.name)
    };
}

async function _getWebhook(webhookId) {
    const contextId = httpContext.get(CONTEXT_ID);

    const webhooksModel = client.model(WEBHOOKS_TABLE_NAME);
    return webhooksModel.findByPk(webhookId, { include: ['events'] });
}

async function init(sequelizeClient) {
    client = sequelizeClient;
    await initSchemas();
}

async function getAllWebhooks() {
    const contextId = httpContext.get(CONTEXT_ID);

    const webhooksModel = client.model(WEBHOOKS_TABLE_NAME);
    const webhooks = await webhooksModel.findAll({ include: ['events'], order: [['updated_at', 'DESC']] });
    return webhooks.map(parseWebhook);
}

async function getWebhook(webhookId) {
    const webhook = await _getWebhook(webhookId);
    return parseWebhook(webhook);
}

async function getAllGlobalWebhooks() {
    const contextId = httpContext.get(CONTEXT_ID);

    const webhooksModel = client.model(WEBHOOKS_TABLE_NAME);
    const webhooks = await webhooksModel.findAll({ include: ['events'], where: { global: true } });
    return webhooks.map(parseWebhook);
}

async function createWebhook(webhook) {
    const contextId = httpContext.get(CONTEXT_ID);

    const id = uuid.v4();
    const webhooksModel = client.model(WEBHOOKS_TABLE_NAME);
    const webhooksEvents = client.model(WEBHOOKS_EVENTS_TABLE_NAME);
    const events = await webhooksEvents.findAll({ where: { name: webhook.events } });
    const eventsIds = events.map(({ id }) => id);
    const webhookToInsert = {
        id,
        name: webhook.name,
        url: webhook.url,
        format_type: webhook.format_type,
        global: webhook.global
    };

    if (contextId) {
        webhookToInsert.context_id = contextId;
    }

    await client.transaction(async function(transaction) {
        const createdWebhook = await webhooksModel.create(webhookToInsert, { transaction });
        await createdWebhook.setEvents(eventsIds, { transaction });
        return createdWebhook;
    });
    const retrievedWebhook = await webhooksModel.findByPk(id, { include: ['events'] });
    const parsedWebhook = parseWebhook(retrievedWebhook);
    return parsedWebhook;
}

async function deleteWebhook(webhookId) {
    const contextId = httpContext.get(CONTEXT_ID);

    const webhooksModel = client.model(WEBHOOKS_TABLE_NAME);
    const options = {
        where: {
            id: webhookId
        }
    }

    if (contextId) {
        options.where.context_id = contextId;
    }

    return webhooksModel.destroy(options);
}

async function updateWebhook(webhookId, updatedWebhook) {
    const webhooksModel = client.model(WEBHOOKS_TABLE_NAME);
    const webhooksEvents = client.model(WEBHOOKS_EVENTS_TABLE_NAME);

    const oldWebhook = await _getWebhook(webhookId);
    const newWebhookEvents = await webhooksEvents.findAll({ where: { name: updatedWebhook.events } });
    const newWebhookEventsIds = newWebhookEvents.map(({ id }) => id);

    await client.transaction(async function(transaction) {
        await oldWebhook.setEvents(newWebhookEventsIds, { transaction });
        return webhooksModel.update(updatedWebhook, { where: { id: webhookId }, transaction });
    });
    return getWebhook(webhookId);
}

async function initSchemas() {
    const webhooksSchema = client.define(WEBHOOKS_TABLE_NAME, {
        id: {
            type: Sequelize.DataTypes.UUID,
            primaryKey: true
        },
        name: {
            type: Sequelize.DataTypes.TEXT('medium')
        },
        url: {
            type: Sequelize.DataTypes.STRING
        },
        global: {
            type: Sequelize.DataTypes.BOOLEAN
        },
        format_type: {
            type: Sequelize.DataTypes.STRING
        },
        created_at: {
            type: Sequelize.DataTypes.DATE
        },
        updated_at: {
            type: Sequelize.DataTypes.DATE
        },
        context_id: {
            type: Sequelize.DataTypes.STRING
        }
    });
    const webhooksEvents = client.define(WEBHOOKS_EVENTS_TABLE_NAME, {
        id: {
            type: Sequelize.DataTypes.UUID,
            primaryKey: true
        },
        name: {
            type: Sequelize.DataTypes.TEXT('medium')
        }
    });

    webhooksSchema.belongsToMany(webhooksEvents, {
        through: WEBHOOKS_EVENTS_MAPPING_TABLE_NAME,
        as: 'events',
        foreignKey: 'webhook_id',
        onDelete: 'CASCADE'
    });
    webhooksEvents.belongsToMany(webhooksSchema, {
        through: WEBHOOKS_EVENTS_MAPPING_TABLE_NAME,
        as: 'webhooks',
        foreignKey: 'webhook_event_id'
    });

    await webhooksSchema.sync();
    await webhooksEvents.sync();
}
