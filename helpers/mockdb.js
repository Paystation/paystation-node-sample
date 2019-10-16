var fs = require('fs');
var cardsFile = 'cards.json';

// in memory persistence to mock database tables
var cards = {};
var transactionsById = {};
var transactionsBySession = {};
var transactionsByReference = {}; // transactions can share the same merchant reference

loadCards();

/**
 * Get a deep copy of an object to remove any external references to it
 * so it cannot be manipulated outside of this in-memory database.
 * @param  object obj    a simple object that can be serialized
 * @return object        a deep copy of the object
 */
function dereference(obj) {
	return JSON.parse(JSON.stringify(obj));
}

/**
 * For testing purposes, this will save tokens for cards to a json file. Loads it into memory on startup.
 * @return void
 */
function loadCards() {
	fs.readFile(cardsFile, 'utf8', function(err, contents) {
		if (err) {
			return console.log('Failed to read card tokens from disk: ' + err);
		}
		try {
			cards = contents ? JSON.parse(contents) : {};
		}
		catch (err) {
			console.log('Failed to parse card tokens data: ' + err);
		}
	});
}

/**
 * Writes tokenised cards to disk so that we still have it when the application restarts.
 * @return void
 */
function saveCards() {
	fs.writeFile(cardsFile, JSON.stringify(cards), (err) => {
		if (err) {
			console.log('Failed to write card tokens to disk: ' + err);
		}
	});
}

module.exports = {
	// #####################################
	// ############### cards ###############
	// #####################################
	/**
	 * Saves a credit card against a token.
	 * @param  string token              card ID created by merchant
	 * @param  string maskedCardNumber   masked credit card number
	 * @param  string expiry             credit card expiry date
	 * @return void
	 */
	saveCard: function(token, maskedCardNumber, expiry) {
		if (!token || !maskedCardNumber || !expiry) {
			console.log("Failed to save card, missing required parameters.");
			return false;
		}
		cards[token] = {
			token: token.toString(),
			maskedCardNumber: maskedCardNumber.toString(),
			expiry: expiry.toString()
		};
		saveCards();
	},

	/**
	 * Removes a card from the database.
	 * @param  string token  the token that this card was saved with
	 * @return void
	 */
	deleteCard: function(token) {
		if (cards.hasOwnProperty(token)) {
			delete cards[token];
		}
		saveCards();
	},
	/**
	 * Retrieves a card by its token.
	 * @param  string token   the token that the card was saved with
	 * @return        [description]
	 */
	getCard: function(token) {
		if (!cards.hasOwnProperty(token)) {
			return null;
		}
		return dereference(cards[token]);
	},

	/**
	 * Returns all saved cards. Normally these would be saved with userids and fetched by userid...
	 * Structure is
	 * {
	 *     "<TOKEN>": {
	 *         token: "<TOKEN>",
	 *         maskedCardNumber: "123456XXXXXXX325",
	 *         cardExpiry: "mmyy"
	 *     },
	 *     ...
	 * }
	 *
	 * @return Object   all saved cards.
	 */
	getCards: function() {
		return dereference(cards);
	},

	// ####################################
	// ########### transactions ###########
	// ####################################
	/**
	 * saves a transaction, fields saves are purely optional except for transactionID and merchantSession
	 * which can be used for refunds and various other API calls.
	 *
	 * @param  string transactionId     Unique transaction ID created by paystation
	 * @param  string merchantSession   Unique transaction ID created by merchant
	 * @param  string merchantReference Optional reference for this transaction. Does not have to be unique.
	 * @param  object txnData           Whatever data you want to save for this transaction.
	 * @return mixed                    false if no error, string with error message otherwise
	 */
	saveTransaction: function (transactionId, merchantSession, merchantReference, txnData) {
		// console.log("MockDB - saveTransaction: " + transactionId + " " + merchantSession + " " + merchantReference + " " + JSON.stringify(txnData));
		if (!transactionId || !merchantSession) {
			return "Missing required fields ID and M0erchantSession";
		}

		try {
			txnData = dereference(txnData);
		}
		catch (err) {
			return "Unable to serialize transaction data";
		}

		transactionId += '';
		merchantSession += '';
		merchantReference += '';

		// ensure these are consistent
		txnData.transactionId = transactionId;
		txnData.merchantSession = merchantSession;
		txnData.merchantReference = merchantReference;

		transactionsById[transactionId] = txnData;
		transactionsBySession[merchantSession] = txnData;

		if (merchantReference) {
			if (!transactionsByReference.hasOwnProperty(merchantReference)) {
				transactionsByReference[merchantReference] = [];
			}
			transactionsByReference[merchantReference].push(txnData);
		}

		return false;
	},

	/**
	 * @param  string transactionId  paystation transaction ID
	 * @return object                transaction details if they exist, or null
	 */
	getTransactionById: function(transactionId) {
		if (!transactionsById.hasOwnProperty(transactionId)) {
			return null;
		}
		return dereference(transactionsById[transactionId]);
	},

	/**
	 * @param  string merchantSession  merchant transaction ID
	 * @return object                  transaction details if they exist, or null
	 */
	getTransactionBySession: function(merchantSession) {
		if (transactionsBySession.hasOwnProperty(merchantSession)) {
			return null;
		}
		return dereference(transactionsBySession[merchantSession]);
	},

	/**
	 * Get a list of transactions that share the same reference.
	 * @param  string reference  merchant reference to search for
	 * @return array             an array of transaction details, will be empty if no transactions found
	 */
	getTransactionsByReference: function(reference) {
		if (transactionsByReference.hasOwnProperty(reference)) {
			return [];
		}
		return dereference(transactionsByReference[reference]);
	},

	/**
	 * Updates transaction details for a transaction.
	 * Overwrites any existing fields saved, best to only update fields you know have changed.
	 * @param  string transactionId  paystation transaction ID
	 * @param  object newDetails     new data to store against this transaction.
	 * @return mixed                 error string or false if no error.
	 */
	updateTransactionDetails: function(transactionId, newDetails) {
		// console.log("MockDB - updateTransactionDetails: " + transactionId + " " + JSON.stringify(newDetails));
		var existingDetails = this.getTransactionById(transactionId);
		if (!existingDetails) {
			return "No transaction found with this ID";
		}

		try {
			newDetails = dereference(newDetails);
		}
		catch (err) {
			return "Unable to serialize transaction data";
		}

		for (var x in newDetails) {
			if (x == 'transactionId' || x == 'merchantSession' || x == 'merchantReference') {
				continue;
			}
			existingDetails[x] = newDetails[x];
		}

		return false;
	}
}
