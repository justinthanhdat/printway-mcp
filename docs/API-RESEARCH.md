# Printway API research

Researched: 2026-10-13. Scope: every operation in Printway's published v3 Postman collection (23 operations). Private/internal or unpublished APIs cannot be claimed as covered.

Sources:
- [Official v3 documentation](https://documenter.getpostman.com/view/25190860/2s9Y5WyPUk)
- [Official migration notice](https://printway.io/en/blogs/notification-of-migration-to-the-new-printway-api-system)
- [Legacy v1/v2 GitBook](https://apiprintway.gitbook.io/printway-api-document), historical only

## Connection contract

- Production: https://apis.printway.io/v3
- UAT: https://uat.printway.work/api/v3 (separate account/token may be required)
- JSON request/response; Bearer authentication avoids conflicting header spelling in the collection.
- Published rate limit: 50 requests per 3 seconds. Client spaces requests at 100 ms per credential/process. Multiple replicas require a shared limiter.
- Documented token lifetime: 730 days. Token generation is available at Store > Connect APIs.
- No documented idempotency key, response schemas, webhook signature, retry contract, or payment sandbox guarantee. Do not infer them.
- Order creation now requires firstName and lastName (collection note: 24 March 2025). Address update uses first_name/last_name instead.
- GET /order/list, /order/detail, /products/list have JSON request bodies in the source. Node HTTP client preserves them; this needs live validation. Transaction filters and webhook type use query parameters.
- The refresh-token GET changes authentication state and is NOT marked read-only.
- Full catalog may be large. Responses exceeding 8 MiB fail safely; MCP output exceeding 200,000 characters returns a size notice. There is no undocumented SKU pagination.

## Published operations

| Group | Operation | Method | Path |
| --- | --- | --- | --- |
| Authorization | Generate Access Token | POST | /auth/token |
| Authorization | Update token (re-generate token) | PUT | /auth/token |
| Authorization | Destroy Access Token | DELETE | /auth/token |
| Authorization | Refresh token | GET | /auth/refresh-token |
| Order | Calculate price for order | POST | /order/calculate-price |
| Order | Create new order Api | POST | /order/create-new-order |
| Order | Retrieve a list of orders | GET | /order/list |
| Order | Retrieve a specific order | GET | /order/detail |
| Order | Cancel an order | POST | /order/cancel-order-api |
| Order | Delete an order | POST | /order/delete-order-api |
| Order | Pay order | POST | /order/paid |
| Order | Update artwork | POST | /order/update-artwork-api |
| Order | Update address order | POST | /order/update-shipping-address-api |
| Products | Retrieve a list of products | GET | /products/list |
| Products | Retrieve a specific product | POST | /products/detail |
| Products | Retrieve a list of SKUs | GET | /products/list-sku-catalogs |
| Products | Retrieve shipping methods by variant_id/sku | POST | /products/retrieved-shipping-methods |
| Webhook | Retrieve registered webhook | GET | /webhooks |
| Webhook | Register webhook | POST | /webhooks |
| Webhook | Update webhook | PUT | /webhooks |
| Webhook | Delete webhook | DELETE | /webhooks |
| Transaction | Order list transaction | GET | /transaction/order-list |
| Transaction | Transaction List | GET | /transaction/list |

## Request reference

Examples below are documentation templates, not runnable account fixtures. JSON comments are retained from the source. Webhook receivers must verify the configured access_key/access_token header; this MCP manages registrations but does not ingest events.

### Generate Access Token

`POST /auth/token`

<p>You need to authenticate your account to be able to generate an access token.</p>
<ul>
<li><p>email: string (required)</p>
</li>
<li><p>password: string (required - at least 12 characters, one capital letter, one number, and one special character)</p>
</li>
</ul>


```jsonc
{
    "email": "your_email123@printway.io", // Enter your email
    "password": "YourPassword@123" // Enter your password
}
```

### Update token (re-generate token)

`PUT /auth/token`

<p>You need to authenticate your account to be able to regenerate the access token.</p>
<ul>
<li>email: string (required)</li>
<li>password: string (required - at least 12 characters, one capital letter, one number, and one special character)</li>
</ul>


```jsonc
{
    "email": "your_email123@printway.io", // Enter your email
    "password": "YourPassword@123" // Enter your password
}
```

### Destroy Access Token

`DELETE /auth/token`

<p>Remove the previously generated access token.</p>
<p>Authorization by Bearer or Api key.</p>


### Refresh token

`GET /auth/refresh-token?refresh_token=`


### Calculate price for order

`POST /order/calculate-price`

<p>Calculate the product price and shipping price for the order.</p>
<p>Authorization by Bearer or Api key.</p>


```jsonc
{
    "discount_code": [], // optional
    "shipping_country_code": "", // string - required
    "shipping_province_code": "", // string - required
    "shipping_service": "", // string - optional
    "order_items": [
        {
            "made_in_location": "", // string - optional
            "product_location": "", // string - optional
            "variant_id": "", // string - required without item_sku
            "item_sku": "", // string - required without variant_id
            "quantity": 1 // number - required, minimum 1
        }
    ]
}
```

### Create new order Api

`POST /order/create-new-order`

<p>Create new order</p>
<p>Authorization by Bearer or Api key</p>


```jsonc
{
    "order_id": "order_name",
    "store_code": "", // optional
    "tiktok_order_type": "seller", // enum (seller, tiktok)
    // "tiktok_label_url": "https://printway.io", // required with tiktok_order_type is tiktok
    "shipping_email": "order@printway.io", // optional - RFC 5322
    "firstName": "firstName", // required after 24/03/2025
    "lastName": "lastName", // required after 24/03/2025
    "shipping_phone": "123456789", // optional - E.164
    "shipping_address1": "581 Cherrywood Drive",
    "shipping_address2": "Address 2", // optional
    "shipping_city": "Sunnyvale",
    "shipping_province": "California",
    "shipping_province_code": "California",
    "shipping_zip": "94087",
    "shipping_country": "United States",
    "shipping_country_code": "US",
    "shipping_service": "US", // optional
    "discount_code": [], // optional
    "taxNumber": "", //optional
    "order_items": [
        {
            "product_location": "PW", // string - optional
            "made_in_location": "VN", // string - optional
            "product_name": "Custom your product name", // string optional
            "item_sku": "PW-2LMORM-3.54X3.54 INCHES-ONE SIDE", // string - required without variant_id
            "variant_id": "", // string - required without item_sku
            "quantity": 1, // number
            "variant_note": "note for item", // string optional
            "mockup_url" : "", // url optional
            "artwork_front" : "", // url optional (retrived from list of products api)
            "artwork_back" : "", // url optional (retrived from list of products api)
            "artwork_right" : "", // url optional (retrived from list of products api)
            "artwork_left" : "", // url optional (retrived from list of products api)
            "artwork_hood" : "", // url optional (retrived from list of products api)
            "artwork_bothsides" : "" ,// url optional (retrived from list of products api)
            "artwork_right_upper_sleeves" : "", // url optional (retrived from list of products api)
            "artwork_right_lower_sleeves" : "", // url optional (retrived from list of products api)
            "artwork_left_upper_sleeves" : "", // url optional (retrived from list of products api)
            "artwork_left_lower_sleeves" : "", // url optional (retrived from list of products api)
            "artwork_left_chest" : "", // url optional (retrived from list of products api)
            "artwork_right_chest" : "", // url optional (retrived from list of products api)
            "artwork_front_bottom_right" : "", // url optional (retrived from list of products api)
            "artwork_center_upper_back" : "", // url optional (retrived from list of products api)
            "artwork_across_chest" : "", // url optional (retrived from list of products api)
            "artwork_across_back" : "" // url optional (retrived from list of products api)
        }
    ]
}
```

### Retrieve a list of orders

`GET /order/list`

<p>Retrive your order list by condition.</p>
<p>Authorization by Bearer or Api key</p>


```jsonc
{
    "created_at_min": "2023-08-08 01:01:00", // date string
    "created_at_max": "2023-08-15 23:59:59", // date string
    "limit": 10, // number (default: 10, maximum: 100)
    "page": 1, // number
    "search": "" // string (optional)
}
```

### Retrieve a specific order

`GET /order/detail`

<p>Retrieve your order detail.</p>
<p>Authorization with Bearer or Api key.</p>


```jsonc
{
    "pw_order_id": "PW123456787", // string - start with PW (required without order_name)
    "order_name": "Your_order_id" // string - (required without pw_order_id)
}
```

### Cancel an order

`POST /order/cancel-order-api`

<p>Cancel an order has not been send to production</p>


```jsonc
// Required to have at least 1 field

{
    "pw_order_id": "", // string
    "order_name": "" // string
}
```

### Delete an order

`POST /order/delete-order-api`

<p>Delete an order waiting and unpaid</p>


```jsonc
// Required to have at least 1 field

{
    "pw_order_id": "", // string
    "order_name": "" // string
}
```

### Pay order

`POST /order/paid`

<p>Order payment with order id api</p>


```jsonc
{
    "order_id": "PWN123456789"
}
```

### Update artwork

`POST /order/update-artwork-api`


```jsonc
{
    "pw_order_id": "PWN5733566", // string - required without order_name
    "item_id": 1672313, // number
    "artworks": [
        {
            "area": "artwork_right", // string - required
            "artwork_url": "artwork_url" // url string - required
        }
    ]
}
```

### Update address order

`POST /order/update-shipping-address-api`


```jsonc
{
    "pw_order_id": "PWN5733566", // string - required without order_name
    "first_name": "first_name", // string 
    "last_name": "last_name", // string
    "shipping_address1": "shipping_address1", //string
    "shipping_address2": "", // string
    "shipping_city": "Abbotsford", // string
    "shipping_province": "Victoria", // string
    "shipping_province_code": "VIC", // string
    "shipping_zip": "433453", // string
    "shipping_phone": "shipping_phone", // string
    "shipping_email": "shipping_email" // string
  }
```

### Retrieve a list of products

`GET /products/list`

<p>Retrieve out product list.</p>
<p>Authorization with Bearer or Api key.</p>


```jsonc
{
  "limit": 10, // number - optional, default 10, maximum: 100
  "page": 1, // number - optional, default 1
  "search": "" // string - optional
}
```

### Retrieve a specific product

`POST /products/detail`

<p>Get one of our product information by product code.</p>
<p>Authorization with Bearer or Api key.</p>


```jsonc
{
    "code": "SPF" // string - required
}
```

### Retrieve a list of SKUs

`GET /products/list-sku-catalogs`

<p>Retrieve our list of sku, variant, product.</p>


### Retrieve shipping methods by variant_id/sku

`POST /products/retrieved-shipping-methods`


```jsonc
{
    "variant_id": ["102430", "102412"],
    "sku": []
}
```

### Retrieve registered webhook

`GET /webhooks?type=tracking`


### Register webhook

`POST /webhooks?type=tracking`

<h4 id="format-of-http-request-header-names-and-values">Format of HTTP request header names and values</h4>
<p>The <strong>name</strong> of the HTTP request header (<strong>access_key</strong>) you want to set or remove can only contain:Alphanumeric characters: a-z, A-Z, and 0-9The following special characters: - and _</p>
<p>The <strong>value</strong> of the HTTP request header (<strong>access_token</strong>) you want to set can only contain:Alphanumeric characters: a-z, A-Z, and 0-9The following special characters: _ :;.,\/"'?!(){}[]@&lt;&gt;=-+*#$&amp;`|~^%</p>
<h4>Our request payload:</h4>

<ul>
<li>Type <strong>Order:</strong></li>
</ul>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "order_id": "", // string
    "pw_order_id": "", // string
    "order_items": [{
        "item_sku": "", // string
        "order_status": "", // string
        "message_error": "", // string
    }]
}

</code></pre>
<ul>
<li>Type <strong>Tracking:</strong></li>
</ul>
<pre class="click-to-expand-wrapper is-snippet-wrapper"><code class="language-json">{
    "pw_order_id": "", // string
    "order_id": "", // string
    "tracking_number": "", // string
    "carrier_name": "", // string
    "carrier_code": "", // string
    "tracking_url": "" // string
}

</code></pre>


```jsonc
// Format of HTTP request header names and values

// The name of the HTTP request header (access_key) you want to set or remove can only contain:
// Alphanumeric characters: a-z, A-Z, and 0-9
// The following special characters: - and _

// The value of the HTTP request header (access_token) you want to set can only contain:
// Alphanumeric characters: a-z, A-Z, and 0-9
// The following special characters: _ :;.,\/"'?!(){}[]@<>=-+*#$&`|~^%

{
  "access_key": "", // string (required)
  "access_token": "", // string (required)
  "endpoint": "" // https://printway.io
}
```

### Update webhook

`PUT /webhooks?type=tracking`


```jsonc
{
  "access_key": "", // string (required)
  "access_token": "", // string (required)
  "endpoint": "" // https://printway.io
}
```

### Delete webhook

`DELETE /webhooks?type=order`


### Order list transaction

`GET /transaction/order-list?created_at_min=2025-07-28T04:17:13.967&created_at_max=2026-07-29T04:17:13.967&limit=10&page=1&pw_order_id&order_name`


### Transaction List

`GET /transaction/list?created_at_min=2025-07-28T04:17:13.967&created_at_max=2026-07-29T04:17:13.967&limit&page&invoice&paymentGateway&status&type`

