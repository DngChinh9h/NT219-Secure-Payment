'use strict';
const express = require('express');
const router  = express.Router();
const { authenticate }  = require('../gateway/authMiddleware');
const { requireRole }   = require('../gateway/authzMiddleware');
const ctrl = require('./transactionController');

router.post('/receipt/verify', ctrl.verifyReceipt);

router.use(authenticate);

router.get('/mine',       ctrl.getMyTransactions);
router.get('/audit-logs/verify', requireRole('admin'), ctrl.verifyAuditLogs);
router.get('/audit-logs', requireRole('admin'), ctrl.getAuditLogs);
router.get('/:id/receipt', ctrl.getReceipt);

module.exports = router;
