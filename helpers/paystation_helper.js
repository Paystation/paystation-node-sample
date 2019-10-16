var request = require('request');
var uuid = require('uuid');
var crypto = require('crypto-js');
var xmlparser = require('xml2js').parseString;

const CONFIG = require('./config.json'); // The CONFIG file for storing application settings/preferences
var mockDb = require('./mockdb.js'); // A makeshift database purely for proof of concept

/**
 * Wrapper around the database request for obtaining all
 * the tokenized cards
 */
exports.getCards = function(callback) {
	var cards = mockDb.getCards();
	callback(cards);
}

/**
 * Wrapper around the database request for obtaining a single
 * single tokenized card details
 */
exports.getCard = function(token, callback) {
	callback(mockDb.getCard(token));
}

/**
 * This function makes a POST request to paystation to initiate token creation.
 * The result of this initiation request is saved in the database and then
 * handled by the callback parsed to return the transaction but more specifically 'digitalOrderUrl'.
 */
exports.createToken = function(callback) {
	// Generates a unique merchant session to identify the transaction request
	var merchantSession = generateMerchantSession();
	
	// Mandatory parameters for token creation, to be sent through the body of the request
	// optional parameters for extended functionality can be found through
	// the paystation api docs.
	var params = {
		paystation: '_empty', // Transaction initiator flag
		pstn_pi: CONFIG.paystation_id, // Your paystation id
		pstn_gi: CONFIG.gateway_id, // Your gateway id
		pstn_ms: merchantSession, // Unique identifier for every transaction request 
		pstn_nr: 't', // Whether or not to redirect from the hosted payment page
		pstn_fp: 't', // Identifies this as a token transaction
		pstn_fs: 't' // Identifies this as a token save only
	};
	
	var transaction = {
		merchantSession: merchantSession
	}
	
	// Sends a POST request to the paystation api sending the above parameters as above
	paystationPost(CONFIG.paystation_url, params, function(err, res) {
		if(err) {
			return callback(err);
		}
		
		// Return an error message if the result of the request is empty
		if(!res) {
			return callback("No Response from Paystation: createToken failed");
		}
		
		// The paystation api sends responses as XML, we parse it to JS objects for simplified handling
		xmlparser(res, function(err, result) {
			if(result.hasOwnProperty('PaystationFuturePaymentResponse')) {
				err = '(Error code ' + result.PaystationFuturePaymentResponse.ec[0] + ') ' + result.PaystationFuturePaymentResponse.em[0]; 
			}
			
			if(err){
				return callback('Error creating token: ' + err);
			}
			
			// If the result of the request was successful
			if(result.InitiationRequestResponse.hasOwnProperty('DigitalOrder')) {
				transaction.transactionId = result.InitiationRequestResponse.PaystationTransactionID[0];
				transaction.digitalOrderUrl = result.InitiationRequestResponse.DigitalOrder[0];
			}
			
			// save the transaction initiation in the database
			mockDb.saveTransaction(transaction.transactionId, transaction.merchantSession, null, transaction);
			
			// send the transaction results back through the callback
			callback(null, transaction);
		});
	});
}

/**
 * This function makes a POST request to paystation to delete a token.
 * The result of this initiation request is saved in the database and then
 * handled by the callback parsed to return the transaction but more specifically 'digitalOrderUrl'.
 */
exports.deleteToken = function(token, merchantReference, callback) {
	// Generates a unique merchant session to identify the transaction request
	var merchantSession = generateMerchantSession();
	
	// Mandatory parameters for token deletion, to be sent through the body of the request
	// optional parameters for extended functionality can be found through
	// the paystation api docs.
	var params = {
		paystation: '_empty', // Transaction initiator flag
		pstn_pi: CONFIG.paystation_id, // Your paystation id
		pstn_gi: CONFIG.gateway_id, // Your gateway id
		pstn_ms: merchantSession, // Unique identifier for every transaction request 
		pstn_ft: token, // Unique token identifier that identifies paystations stored credit card details
		pstn_nr: 't', // Whether or not to redirect from the hosted payment page
		pstn_fp: 't', // Identifies this as a token transaction
		pstn_fx: 't', // Identifies this as a token save only
		pstn_2p: 't' // Identifies this as a 2-party transaction
	};
	
	var transaction = {
		merchantReference: merchantReference,
		merchantSession: merchantSession
	}
	
	// Sends a POST request to the paystation api sending the above parameters as above
	paystationPost(CONFIG.paystation_url, params, function(err, res) {
		if(err) {
			return callback(err);
		}
		
		// Return an error message if the result of the request is empty
		if(!res) {
			return callback("No Response from Paystation: deleteToken failed");
		}
		
		// The paystation api sends responses as XML, we parse it to JS objects for simplified handling
		xmlparser(res, function(err, result) {		
			if(result.hasOwnProperty('PaystationFuturePaymentResponse')) {
				err = '(Error code ' + result.PaystationFuturePaymentResponse.ec[0] + ') ' + result.PaystationFuturePaymentResponse.em[0]; 
			}
			
			if(err || !result || !result.hasOwnProperty('response')){
				return callback("Error deleting token: " + err);
			}
			
			transaction.transactionId = result.response.PaystationTransactionID[0];
			transaction.paymentRequestTime = result.response.PaymentRequestTime[0];
			transaction.hasError = false;
			transaction.errorMessage = result.response.em[0];
			transaction.errorCode = result.response.ec[0];
			
			// save the transaction initiation in the database
			mockDb.updateTransactionDetails(transaction.transactionId, transaction.merchantSession, transaction.merchantReference, transaction);
			
			//delete card from database if request is successful
			if(result.response.ec[0] == 34){
				mockDb.deleteCard(token);
			}
			
			// send the transaction results back through the callback
			callback(null, transaction);
		});
	});
}

/**
 * This function makes a POST request to paystation to bill a credit card
 * using a token. The result of this request is saved in the database and then
 * handled by the callback parsed to return the transaction.
 */
exports.billToken = function(token, amount, merchantReference, callback) {
	// Generates a unique merchant session to identify the transaction request
	var merchantSession = generateMerchantSession();
	// Converts the dollar value of amount into a purely cent value
	amount = parseInt(amount * 100);
	
	// Mandatory parameters for a token billing, to be sent through the body of the request
	// optional parameters for extended functionality can be found through
	// the paystation api docs.
	var params = {
		paystation: '_empty', // Transaction initiator flag
		pstn_pi: CONFIG.paystation_id, // Your paystation id
		pstn_gi: CONFIG.gateway_id, // Your gateway id
		pstn_ms: merchantSession, // Unique identifier for every transaction request
		pstn_am: amount, // Transaction amount, defaults to cents
		pstn_ft: token, // Unique token identifier that identifies paystations stored credit card details
		pstn_nr: 't', // Whether or not to redirect from the hosted payment page
		pstn_fp: 't', // Identifies this as a token transaction
		pstn_2p: 't' // Identifies this as a 2-party transaction
	};
	
	// Optional parameter that non uniquely identifies a transaction
	if(merchantReference){
		params.pstn_mr = merchantReference;
	}
	
	var transaction = {
		merchantReference: merchantReference,
		merchantSession: merchantSession
	};
	
	// Sends a POST request to the paystation api sending the above parameters as above
	paystationPost(CONFIG.paystation_url, params, function(err, res) {
		if(err) {
			return callback(err);
		}
		
		// Return an error message if the result of the request is empty
		if(!res) {
			return callback("No Response from Paystation: payToken failed");
		}
		
		// The paystation api sends responses as XML, we parse it to JS objects for simplified handling
		xmlparser(res, function(err, result) {
			console.log(JSON.stringify(result));
			if(err){
				return callback("Error billing token: " + err);
			}
			
			transaction.transactionId = result.PaystationFuturePaymentResponse.PaystationTransactionID[0];
			transaction.paymentRequestTime = result.PaystationFuturePaymentResponse.PaymentRequestTime[0];
			transaction.hasError = false;
			transaction.errorMessage = result.PaystationFuturePaymentResponse.em[0];
			transaction.errorCode = result.PaystationFuturePaymentResponse.ec[0];
			
			// save the transaction in the database
			mockDb.saveTransaction(transaction.transactionId, transaction.merchantSession, transaction.merchantReference, transaction);
			
			// send the transaction results back through the callback
			callback(null, transaction);
		});
	});
}

/**
 * This function makes a POST request to paystation to initiate a 3-party
 * transaction. The result of this initiation request is saved in the database and then
 * handled by the callback parsed to return the transaction but more specifically 'digitalOrderUrl'.
 */
exports.createThreePartyTransaction = function(amount, merchantReference, callback) {
// Generates a unique merchant session to identify the transaction request
	var merchantSession = generateMerchantSession();
	// Converts the dollar value of amount into a purely cent value
	amount = parseInt(amount * 100);
	
	// Mandatory parameters for 3-party transaction initiation, to be sent 
	// through the body of the request optional parameters for extended functionality 
	// can be found through the paystation api docs.
	var params = {
		paystation: '_empty', // Transaction initiator flag
		pstn_pi: CONFIG.paystation_id, // Your paystation id
		pstn_gi: CONFIG.gateway_id, // Your gateway id
		pstn_ms: merchantSession, // Unique identifier for every transaction request
		pstn_am: amount, // Transaction amount, defaults to cents
		pstn_nr: 't' // ... No redirect flag?
	};
	
	// Optional parameter that non uniquely identifies a transaction
	if(merchantReference){
		params.pstn_mr = merchantReference;
	}
	
	// Optional paramater that places the request in a test envionment
	if(CONFIG.test_mode){
		params.pstn_tm = 't';
	}
	
	// Setup of a default transaction
	var transaction = {
		merchantReference: merchantReference,
		merchantSession: merchantSession,
		hasError: true,
		errorCode: -1,
		errorMessage: "Failed to create new transaction. Unexpected response from Paystation."
	}
	
	// Sends a POST request to the paystation api sending the above parameters as above
	paystationPost(CONFIG.paystation_url, params, function(err, res) {
		if(err) {
			return callback(err);
		}
		
		// Return an error message if the result of the request is empty
		if(!res) {
			return callback("No Response from Paystation: createThreePartyTransaction failed");
		}
		
		// The paystation api sends responses as XML, we parse it to JS objects for simplified handling
		xmlparser(res, function(err, result) {
			//console.log(JSON.stringify(result));
			
			if (result.hasOwnProperty('response')) {
				err = '(Error code ' + result.response.ec[0] + ') ' + result.response.em[0];
			}
			
			if(err){
				return callback("Error creating transaction: " + err);
			}
			
			// If the result of the request was successful
			if(result.InitiationRequestResponse.hasOwnProperty('DigitalOrder')){
				transaction.transactionId = result.InitiationRequestResponse.PaystationTransactionID;
				transaction.digitalOrderUrl = result.InitiationRequestResponse.DigitalOrder;
				transaction.paymentRequestTime = result.InitiationRequestResponse.PaymentRequestTime;
				transaction.hasError = false;
				transaction.errorMessage = "Transaction initiated successfully.";
			}
			// If the result was unsuccessful
			else if(result.InitiationRequestResponse.PaystationErrorCode) {
				var errorMessage = "Paystation error code:" + result.InitiationRequestResponse.PaystationErrorCode + " Failed to create new transaction.";
				console.error(errorMessage);
				transaction.errorCode = result.InitiationRequestResponse.PaystationErrorCode;
				transaction.errorMessage = errorMessage;
			}
			
			// save the transaction in the database
			mockDb.saveTransaction(transaction.transactionId, transaction.merchantSession, null, transaction);
			
			// send the transaction results back through the callback
			callback(null, transaction);
		});
	});
}

// Provides a reference between each transaction and its polling request
var timeoutsByTxnId = {};

/**
 * This function starts the polling for checking for a transaction completion.
 * This is an approach to polling paystation to find the resulting outcome of the 
 * transaction request. This is not the recommended approach to this problem as 
 * the 'POST back' method reduces server load.
 */
exports.startPollingTransactionSuccess = function(transaction_id, callback) {
	// Sets the starting time for the polling requests
	var startTime = Date.now();
	
	// Recursive function call where it will continously poll paystation every second
	// until either the transaction is identified as finished by it's error code or
	// alternatively the polling has incurred a total time of 15 minutes.
	// PLEASE NOTE: The polling timeout time is set via the CONFIG
	var pollTransaction = function() {
		// Obtain the details of this transaction from the database
		var transaction = mockDb.getTransactionById(transaction_id);
		
		// Base case: Identifies the transaction as finished when it has an error code
		// returns the resulting transaction details through the callback
		if(transaction && transaction.errorCode > -1) {
			return callback(null, transaction);
		}
		
		// Recursive call: This makes a request to paystation through it's Lookup api,
		// in an attempt to capture the details of the transaction when the user has
		// completed their payment.
		getTransactionFromPaystation(transaction_id, function(err, transaction) {
		
			// Base case: As above, this will also break the recursion and provide
			// the details of the finished payment through the callback.
			if(transaction && transaction.errorCode > -1) {
				return callback(null, transaction);
			}
			
			// If the polling has been occuring for a time less than 15 minutes
			// PLEASE NOTE: The polling time can be changed from 15 minutes and
			// can be set via the CONFIG accordingly
			else if (Date.now() < (startTime + CONFIG.polling_timeout_minutes * 60 * 1000)){
				// Saves the polling request against it's transaction id
				timeoutsByTxnId[transaction_id] = setTimeout(function() {
					pollTransaction();
				}, 1000);
			}
			
			// Case handler where if the user took longer than the specified time out period
			// set via the CONFIG then the function will break and return this error via the callback
			else {
				callback("Took too long to enter in credit card details.");
			}
		});
	}
	
	// Begin the polling recursion
	pollTransaction();
}

// This handles the event in which the details of the finished transaction have been
// successfully captured and we would need to stop the polling.
exports.stopPollingTransaction = function(transaction_id) {
	// Checks to see if the polling request is still happening for a given transaction id
	if(timeoutsByTxnId.hasOwnProperty(transaction_id)) {
		// stop the polling for this transaction id
		clearTimeout(timeoutsByTxnId[transaction_id]);
		// remove the details of this polling
		delete timeoutsByTxnId[transaction_id];
	}
}

/**
 * This function makes a POST request to paystation using the Lookup api.
 * This is used to find out the details of an initiated transaction. The result of this request 
 * is saved in the database and then handled by the callback parsed to return the transaction.
 */
function getTransactionFromPaystation(transaction_id, callback) {
	// Mandatory parameters for a transaction lookup, to be sent 
	// through the body of the request optional parameters for extended functionality 
	// can be found through the paystation api docs.
	var params = {
		pi: CONFIG.paystation_id, // Your paystation id
		ti: transaction_id // The transaction id you want details for
	}
	
	// Setup of a default transaction
	var transaction = {
		errorCode: -1,
		hasError: false,
		errorMessage: "Lookup Failed"
	}
	
	// Sends a POST request to the paystation api sending the above parameters as above
	paystationPost(CONFIG.lookup_url, params, function(err, res) {
		if(err) {
			return callback(err);
		}
			
		if(!res) {
			return callback("No Response from Paystation: getTransactionFromPaystation failed");
		}
		
		// The paystation api sends responses as XML, we parse it to JS objects for simplified handling
		xmlparser(res, function(err, result) {
			if(err || !result || !result.hasOwnProperty('PaystationQuickLookup')) {
				return callback("Error looking up transaction " + err);
			}
			
			// If request was successful
			if(result.PaystationQuickLookup.hasOwnProperty('LookupResponse') && 
			result.PaystationQuickLookup.LookupResponse[0].hasOwnProperty('PaystationTransactionID')){
				transaction = {
					transactionId: result.PaystationQuickLookup.LookupResponse[0].PaystationTransactionID,
					amount: result.PaystationQuickLookup.LookupResponse[0].amount,
					transactionTime: result.PaystationQuickLookup.LookupResponse[0].TransactionTime,
					hasError: false,
					errorCode: result.PaystationQuickLookup.LookupResponse[0].PaystationErrorCode,
					errorMessage: result.PaystationQuickLookup.LookupResponse[0].PaystationErrorMessage,
					cardType: result.PaystationQuickLookup.LookupResponse[0].CardType,
					merchantSession: result.PaystationQuickLookup.LookupResponse[0].MerchantSession,
					requestIp: result.PaystationQuickLookup.LookupResponse[0].RemoteHostAddress
				}
				if(transaction.errorCode == '') {
					transaction.errorCode = -1;
				}
				// Update the local database with the new details obtained from paystation
				mockDb.updateTransactionDetails(transaction_id, transaction);
			}
			
			// send the transaction results back through the callback
			callback(null, transaction);
		});
	});
}

/**
 * This function saves the response from the paystation callback into the database.
 * This is the alternative to the polling method where paystation will send you the 
 * details of a completed transaction when it is ready.
 * PLEASE NOTE: Paystation still utilises XML as it's data format for the callback request,
 * but we are using an xml to json parser middleware on the request for easier handling
 */ 
exports.savePostResponse = function(json, callback) {
	var transaction;
	if(json.hasOwnProperty('paystationpaymentverification')){
		transaction = {
			transactionId: json.paystationpaymentverification.ti,
			amount: json.paystationpaymentverification.purchaseamount,
			transactionTime: json.paystationpaymentverification.transactiontime,
			hasError: false,
			errorCode: json.paystationpaymentverification.ec,
			errorMessage: json.paystationpaymentverification.em,
			cardType: json.paystationpaymentverification.ct,
			merchantSession: json.paystationpaymentverification.merchantsession,
			requestIp: json.paystationpaymentverification.requestip,
			merchantReference: json.paystationpaymentverification.merchantreference
		}
		
		// if the initiation request for this transaction was for a tokenization
		// then the transaction details saved will include a token value of the card details
		if(json.paystationpaymentverification.hasOwnProperty('futurepaymenttoken')) {
			transaction.token = json.paystationpaymentverification.futurepaymenttoken;
			mockDb.saveCard(transaction.token, json.paystationpaymentverification.cardno, json.paystationpaymentverification.cardexpiry)
		}
		
		// Update the local database with the new details obtained from paystation
		mockDb.updateTransactionDetails(transaction.transactionId, transaction);
		
		// send the transaction results back through the callback
		return callback(null, transaction);
	}
	
	// Will ideally never hit this case, in the event it does we return an error message through the callback
	callback("Invalid post response received");
}

/**
 * This function returns a RFC4122 v4 UUID to uniquely identify a merchants session
 */
function generateMerchantSession() {
	return uuid.v4();
}

/** 
 * This function hash's the post body using a shared secret, necessary if you are using 
 * dynamic URLs, or if your IP is not whitelisted. HMAC can be turned on and off via the CONFIG
 */
function generateHMACUrl(params) {
	var webServiceName = 'paystation';
	var timestamp = parseInt(Date.now() / 1000);
	var hmacBody = "" + timestamp + webServiceName + params;
	var hmacHash = crypto.HmacSHA512(hmacBody, CONFIG.hmac_security_code);
	return "?pstn_HMACTimestamp=" + timestamp + "&pstn_HMAC=" + hmacHash;
}

/**
 * This function deals with all the POST requests to paystation, it
 * can be run with HMAC mode or without
 */
function paystationPost(url, data, callback) {
	var params = [];
	for(var x in data) {
		params.push(x + '=' + data[x]);
	}
	params = params.join("&");
	
	// If the application is utilising HMAC's then the parameters will be hashed
	if(CONFIG.hmac_mode) {
		url += generateHMACUrl(params);
	}
	
	// Send the POST request and parse the response back through the callback
	request({
		headers: {
			'Content-Length': params.length,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		uri: url,
		body: params,
		method: 'POST'
		}, function (err, res, body) {
			if(err){
				return callback(err);
			}
			callback(null, body);
		}
	);
}