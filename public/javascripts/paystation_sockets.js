var socket = io();

var payButton = document.getElementById('payButton');
var createTokenButton = document.getElementById('createTokenButton');
var payTokenButton = document.getElementById('tokenPayButton');
var paymentWrapper = document.getElementById('payment_frame_wrapper');

if(payButton) {
	payButton.addEventListener('click', function() {
		var amount = document.getElementById('amount').value;
		socket.emit('startTransaction', amount);
	});
}

if(createTokenButton) {
	document.getElementById('createTokenButton').addEventListener('click', function() {
		socket.emit('createToken');
	});
}

if (window.location.href.match('/token')) {
	socket.emit('get_cards');
	socket.on('load_cards', function(cards) {
		for(var x in cards){
			addTokenToList(cards[x]);
		}
	});
}

if(payTokenButton) {
	document.getElementById('tokenPayButton').addEventListener('click', function() {
		var amount = document.getElementById('amount').value;
		var token = document.getElementById('token').value;
		socket.emit('billToken', token, amount);
	});
}

socket.on('transaction_url', function (url) {
	createPaymentFrame(paymentWrapper, url, onFrameLoaded);
});

socket.on('tokenisation_url', function(url) {
	createPaymentFrame(paymentWrapper, url, onFrameLoaded);
});

socket.on('txn_complete', function(txn) {
	var paymentFrame = paymentWrapper.firstElementChild;
	closePaymentFrame(paymentFrame);
	document.getElementById('flash_message').innerHTML = txn.errorMessage;
});

socket.on('token_txn_complete', function(txn) {
	console.log(txn.errorMessage);
	document.getElementById('flash_message').innerHTML = txn.errorMessage;
});

socket.on('token_complete', function(token) {
	document.getElementById('flash_message').innerHTML = token;
	addTokenToList(token);
	var paymentFrame = paymentWrapper.firstElementChild;
	closePaymentFrame(paymentFrame);
});

socket.on('token_deleted', function(token) {
	var token = document.getElementById(token);
	token.parentElement.removeChild(token);
});

socket.on('error_message', function(err) {
	document.getElementById('flash_message').innerHTML = err;
});

function addTokenToList(card) {
	var li = document.createElement("li");
	li.id = card.token;
	var token = document.createTextNode(card.token);
	var btn = document.createElement("button");
	var deleteBtn = document.createElement('button');
	btn.style.margin = "5px";
	deleteBtn.style.margin = "5px";
	var t = document.createTextNode("select");
	var k = document.createTextNode("delete");
	deleteBtn.onclick = function() {
		socket.emit('deleteToken', card.token);
	}
	btn.onclick = function() {
		document.getElementById('token').value = token.textContent;
	}
	btn.appendChild(t);
	deleteBtn.appendChild(k);
	li.appendChild(btn);
	li.appendChild(deleteBtn);
	li.appendChild(token);
	document.getElementById("card_list").appendChild(li);
}

function createPaymentFrame(parentElement, paymentURL, onLoad) {
	var paymentFrame = document.createElement('iframe');
	paymentFrame.src = paymentURL;
	paymentFrame.style.minHeight = "475px";
	parentElement.appendChild(paymentFrame);
	this.bindFrameLoadEvent(paymentFrame, onLoad);
	return paymentFrame;
}

function onFrameLoaded(iframe) {
	// Browsers shouldn't allow access to the content of an iframe unless it is from your own domain.
	// So, if we can access the content, then the user has been redirected back to your site from paystation.
	if (canAccessIFrame(iframe)) {
		// We have redirected back to our own site inside the iframe.
		// It is possible to grab some data from inside the frame, but it is better and often quicker to use polling to get this response as that data can be trusted.
		closePaymentFrame(iframe);
	}
}

// This is used to detect when the frame is redirected. If you are not using redirects then you wont need to use this.
function bindFrameLoadEvent(frame, onLoad) {
	if (navigator.userAgent.indexOf("MSIE") > -1 && !window.opera) {
		frame.addEventListener('readystatechange', function() {
			if (frame.readyState == "complete") {
				onLoad(frame);
			}
		});
	}
	else {
		frame.addEventListener('load', function() {
			onLoad(frame);
		});
	}
}

	// Most browsers do not allow manipulating the contents of an iframe if it is in a different domain.
	// This can be used to test if the client has been redirected back to your website after making the payment in paystation.
function canAccessIFrame(iframe) {
	var html = null;
	try {
		var doc = iframe.contentDocument || iframe.contentWindow.document;
		html = doc.body.innerHTML;
	}
	catch (err) {}
	return (html != null);
}

function closePaymentFrame(paymentFrame) {
	if (paymentFrame) {
		paymentFrame.parentNode.removeChild(paymentFrame);
		paymentFrame = false;
	}
}