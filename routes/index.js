var express = require('express');
var router = express.Router();

/* GET transaction page. */
router.get('/', function(req, res, next) {
  res.render('index');
});

/* GET token page */
router.get('/token', function(req, res, next) {
	res.render('create_token');
});

module.exports = router;
