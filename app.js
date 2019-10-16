var express = require('express');
var http = require('http');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var xmlparser = require('express-xml-bodyparser');

//paystation helper api
var paystation = require('./helpers/paystation_helper');

var routes = require('./routes/index');

var app = express();

//socket io setup
var server = http.createServer(app);
var io = require('socket.io')(server);
server.listen(3000);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);

/**
 * This is the POST back handler for handling the responses from paystation
 * This should be trusted with actual transaction details and should 
 * be used to update your database with the results values. This is the recommended
 * alternative to the polling method also demo'ed in this code, where instead of you polling paystation
 * for transaction completion, we send a response to your server to notify you when it's done.)
 * PLEASE NOTE: The POST back function from Paystation will not work on local networks 
 * that cannot be accessed externally.
 */
app.post('/paystation_callback', xmlparser({ trim: false, explicitArray: false }), function (req, res) {
    paystation.savePostResponse(req.body, function (err, txnDetails) {
        if (err) {
            return console.error(err);
        }
        var socket = getSocket(txnDetails.transactionId);
        if (socket) {
            console.log('emitting socket trans complete ' + txnDetails.transactionId);
            if (txnDetails.hasOwnProperty('token')) {
                paystation.getCard(txnDetails.token, function (token) {
                    socket.emit('token_complete', token);
                });
            }
            socket.emit('txn_complete', txnDetails);
        }
        paystation.stopPollingTransaction(txnDetails.transactionId);
    });
});

/**
 * This associates each socket connection with a transaction id
 * so that the socket server knows which client it needs to send
 * transaction details
 */
var transactionSocketIndex = {};

/**
 * Get the socket/client associated with the transaction id
 */
function getSocket(transactionId) {
    if (transactionSocketIndex.hasOwnProperty(transactionId)) {
        return transactionSocketIndex[transactionId];
    }
    return null;
}

/**
 * Stores the socket/client associated with the transaction id
 */
function storeSocket(transactionId, client) {
    transactionSocketIndex[transactionId] = client;
}

/**
 * Removes the socket/client associated with the transaction id
 */
function removeSocket(client, txn) {
    if (txn && transactionSocketIndex.hasOwnProperty(txn.transactionId)) {
        return delete transactionSocketIndex[txn.transactionId];
    }
    for (var x in transactionSocketIndex) {
        if (transactionSocketIndex[x] == client) {
            return delete transactionSocketIndex[x];
        }
    }
}

/** 
 * This is the socket "server" it defines the functionality associated
 * with the requests from the client. In this case the socket server handles
 * the process of initiating transactions and token creation
 */
io.on('connection', function (client) {
    /**
     * This socket handler receives the 'get_cards' request from the client
     * and sends the saved tokenized card details back to the client through the 
     * 'load_cards' event.
     * PLEASE NOTE: This implentation is purely for proof of concept, normally
     * in a live environment access controls will be utilised to stop clients accessing
     * each others card details
     */
    client.on('get_cards', function () {
        paystation.getCards(function (cards) {
            client.emit('load_cards', cards);
        });
    });

    /**
     * This socket handler receives the 'createToken' request from the client
     * and sends the result of initation request back to the client through
     * 'tokenisation_error' or 'tokenisation_url' depending on the outcome of request
     */
    client.on('createToken', function () {
        paystation.createToken(function (err, txn) {
            if (err) {
                client.emit('error_message', err);
            } else {
                storeSocket(txn.transactionId, client);
                client.emit('tokenisation_url', txn.digitalOrderUrl);
            }
        });
    });

    /**
     * This socket handler receives the 'createToken' request from the client
     * and sends the result of initation request back to the client through
     * 'tokenisation_error' or 'tokenisation_url' depending on the outcome of request
     */
    client.on('deleteToken', function (token) {
        paystation.deleteToken(token, "sample-node-merch-ref", function (err) {
            if (err) {
                console.log("txn returned error code: " + err);
                client.emit('error_message', err);
            } else {
                client.emit('token_deleted', token);
            }
        });
    });

    /**
     * This socket handler receives the 'billToken' request from the client
     * parsed with an amount and token. This request is sent through to paystation
     * and responds back to the client through 'transaction_error' or 'token_txn_complete'
     * depending on the outcome of the request
     */
    client.on('billToken', function (token, amount) {
        paystation.billToken(token, amount, "sample-node-merch-ref", function (err, txn) {
            if (err) {
                console.log("txn returned error code: " + err);
                client.emit('transaction_error', err);
            } else {
                client.emit('token_txn_complete', txn);
            }
        });
    });

    /**
     * This socket handler receives the 'startTransaction' request from the client
     * peered with the amount of the transaction. This request is sent through to paystation
     * where the transaction request is processed and responds with the 'digitalOrderUrl'
     * which is to be used to carry out the transaction. The server then responds to the client
     * through 'transaction_error' or 'transaction_url' depending on the outcome of the request
     * PLEASE NOTE: The commented out code is an approach to polling paystation to find the
     * resulting outcome of the transaction request. This is not the recommended approach to
     * this problem as the 'POST back' method reduces server load.
     */
    var transaction;
    client.on('startTransaction', function (amount) {
        paystation.createThreePartyTransaction(amount, "sample-node-merch-ref", function (err, txn) {
            if (err) {
                console.log("txn returned error code: " + err);
                client.emit('error_message', err);
            } else {
                storeSocket(txn.transactionId, client);
                transaction = txn;
                client.emit('transaction_url', txn.digitalOrderUrl);
                /**
                 * The below code starts a continous request to the paystation server to find
                 * out when the initiated transaction request has been completed. This is an
                 * alternative to the post response, and can work on local networks.
                 */
                /* paystation.startPollingTransactionSuccess(txn.transactionId, function(err, txn) {
                    if(err) {
                        console.error(err);
                    }
                    if(txn.errorCode > -1 || txn.hasError) {
                        client.emit('txn_complete', txn.errorMessage)
                    }
                }); */
            }
        });
    });

    /**
     * This socket handler deals with the result of a disconnected socket/client,
     * at this point we clean up and remove the stored association between socket and transaction
     */
    client.on('disconnect', function () {
        if (transaction) {
            //paystation.stopPollingTransaction(transaction.transactionId);
        }
        removeSocket(client, transaction);
    });
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function (err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;
