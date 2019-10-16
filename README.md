# Overview

This implementation is a quick proof of concept for a third party integration with Paystation with Node.js

This implementation is a third party integration meaning we supplement the transaction journey through an iFrame hosted by Paystation.
This iFrame can be opened anywhere within your website, it is of a typical approach to display the iFrame after the user has confirmed their order.

Due to the transaction happening through the iFrame, you as the merchant/developer will have no access to when if that transaction has completed
through the iFrame alone.

There are a few ways you are able to check the status of the transaction, this implementation uses two options from the Paystation api.

The first option which is the recommended option is through the Paystation POST back response.
After setting up an integration with paystation our intergration is designed so that when a transaction is completed, be it failed or successful our api will respond with a POST back call to a URL handler of your choice. 
This will send an XML response which will contain and error code and error message a long with other data specific to each transaction.

The second option which is an alternate approach is using our Quick Lookup API. This is essentially an API end point that takes a transaction ID and responds with the status of that transaction. In this implementation we use a polling approach to this. On initiation of a transaction we begin a polling request to the paystation server through the quick lookup api, basically it will continuously make requests to the paystation server until a result code is returned.

# Setup

Install dependencies:

```bash
$ npm install
```

Start your Express.js app at `http://localhost:3000/`:

```bash
$ npm start
```

helpers/config.json - This file contains all your paystation integration logic and will need to be replaced. You will at least need to replace
the paystation_id, gateway_id and hmac_security_code

You may want to handle these details natively to your framework of choice.

helpers/paystation_helper.js - All of the Paystation wrapper logic included in this implementation is placed within this file - This handles all requests that integrate with the paystation server

Most of the other files specifically the front end is specific to your framework choice and is free for you to change as you will
