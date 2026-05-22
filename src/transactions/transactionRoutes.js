'use strict';
const express = require('express');
const router  = express.Router();
const { authenticate }  = require('../gateway/authMiddleware');
const { requireRole }   = require('../gateway/authzMiddleware');
const ctrl = require('./transactionController');

router.use(authenticate);

router.get('/mine',       ctrl.getMyTransactions);
router.get('/audit-logs', requireRole('admin'), ctrl.getAuditLogs);

module.exports = router;
