import { z } from 'zod';
const str = z.string().min(1);
const text = z.string();
const url = z.string().url().refine(v => new URL(v).protocol === 'https:', 'HTTPS URL required');
const page = { limit: z.number().int().min(1).max(100).optional(), page: z.number().int().min(1).optional() };
const dates = { created_at_min: str.describe('Required start datetime, for example 2026-10-01 00:00:00'), created_at_max: str.describe('Required end datetime, for example 2026-10-13 23:59:59') };
const ids = z.object({ pw_order_id: str.optional(), order_name: str.optional() }).strict().refine(v => !!(v.pw_order_id || v.order_name), 'pw_order_id or order_name required');
const item = z.object({ variant_id: str.optional(), item_sku: str.optional(), quantity: z.number().int().min(1), made_in_location: text.optional(), product_location: text.optional(), product_name: text.optional(), variant_note: text.optional(), mockup_url: url.optional(), ...Object.fromEntries(['front','back','right','left','hood','bothsides','right_upper_sleeves','right_lower_sleeves','left_upper_sleeves','left_lower_sleeves','left_chest','right_chest','front_bottom_right','center_upper_back','across_chest','across_back'].map(k => ['artwork_'+k,url.optional()])) }).strict().refine(v => !!(v.variant_id || v.item_sku), 'variant_id or item_sku required');
const shipping = { shipping_address1: str, shipping_address2: text.optional(), shipping_city: str, shipping_province: str, shipping_province_code: str, shipping_zip: str, shipping_phone: text.optional(), shipping_email: z.string().email().optional() };
const type = z.enum(['tracking','order']).default('tracking');
const hook = { type, endpoint: url, access_key: z.string().regex(/^[A-Za-z0-9_-]+$/), access_token: str.refine(v => !/[\r\n\x00]/.test(v), 'Invalid header value') };
export type Operation = { name: string; title: string; method: string; path: string; schema: z.ZodType; read: boolean; destructive?: boolean; admin?: boolean; query?: boolean };
const op = (name: string,title: string,method: string,path: string,schema: z.ZodType,read = false,extra: Partial<Operation> = {}): Operation => ({name:'printway_'+name,title,method,path,schema,read,...extra});
export const operations: Operation[] = [
 op('generate_access_token','Generate API token using server-configured account credentials','POST','/auth/token',z.object({}).strict(),false,{admin:true}),
 op('regenerate_access_token','Regenerate API token using server credentials; may invalidate previous connections','PUT','/auth/token',z.object({}).strict(),false,{admin:true,destructive:true}),
 op('destroy_access_token','Revoke the current Printway API token','DELETE','/auth/token',z.object({}).strict(),false,{admin:true,destructive:true}),
 op('refresh_access_token','Refresh API token using server-configured refresh token','GET','/auth/refresh-token',z.object({}).strict(),false,{admin:true,query:true}),
 op('calculate_order_price','Calculate product and shipping prices without placing an order','POST','/order/calculate-price',z.object({shipping_country_code:str,shipping_province_code:str,shipping_service:text.optional(),discount_code:z.array(text).optional(),order_items:z.array(item).min(1)}).strict(),true),
 op('create_order','Create a fulfillment order; use a unique order_id and do not blindly retry','POST','/order/create-new-order',z.object({order_id:str,store_code:text.optional(),tiktok_order_type:z.enum(['seller','tiktok']).optional(),tiktok_label_url:url.optional(),firstName:str,lastName:str,...shipping,shipping_country:str,shipping_country_code:str,shipping_service:text.optional(),discount_code:z.array(text).optional(),taxNumber:text.optional(),order_items:z.array(item).min(1)}).strict().refine(v => v.tiktok_order_type !== 'tiktok' || !!v.tiktok_label_url,'TikTok label URL required')),
 op('list_orders','List orders with pagination and optional date/search filters','GET','/order/list',z.object({...page,...dates,search:text.optional()}).strict(),true),
 op('get_order','Get order details including status and tracking by ID or order name','GET','/order/detail',ids,true),
 op('cancel_order','Cancel an order before it is sent to production','POST','/order/cancel-order-api',ids,false,{destructive:true}),
 op('delete_order','Delete a waiting unpaid order','POST','/order/delete-order-api',ids,false,{destructive:true}),
 op('pay_order','Pay an order: spends funds and may start fulfillment','POST','/order/paid',z.object({order_id:str}).strict(),false,{destructive:true}),
 op('update_artwork','Change order item artwork','POST','/order/update-artwork-api',z.object({pw_order_id:str,item_id:z.number().int().positive(),artworks:z.array(z.object({area:str,artwork_url:url}).strict()).min(1)}).strict()),
 op('update_shipping_address','Change shipping address for an order','POST','/order/update-shipping-address-api',z.object({pw_order_id:str,first_name:str.optional(),last_name:str.optional(),...Object.fromEntries(Object.entries(shipping).map(([k,v]) => [k,v.optional()]))}).strict().refine(v => Object.keys(v).length > 1,'Provide an address field to update')),
 op('list_products','Search product catalog with pagination','GET','/products/list',z.object({...page,search:text.optional()}).strict(),true),
 op('get_product','Get product details, variants and artwork areas by product code','POST','/products/detail',z.object({code:str}).strict(),true),
 op('list_sku_catalogs','Get the documented SKU, variant and product catalog','GET','/products/list-sku-catalogs',z.object({}).strict(),true),
 op('get_shipping_methods','Get shipping options for variant IDs or SKUs','POST','/products/retrieved-shipping-methods',z.object({variant_id:z.array(str).optional(),sku:z.array(str).optional()}).strict().refine(v => !!(v.variant_id?.length || v.sku?.length),'Provide variant IDs or SKUs'),true),
 op('get_webhook','Get registered tracking or order webhook','GET','/webhooks',z.object({type}).strict(),true,{query:true}),
 op('register_webhook','Register tracking or order webhook with receiver authorization','POST','/webhooks',z.object(hook).strict()),
 op('update_webhook','Update tracking or order webhook','PUT','/webhooks',z.object(hook).strict()),
 op('delete_webhook','Remove tracking or order webhook','DELETE','/webhooks',z.object({type}).strict(),false,{query:true,destructive:true}),
 op('list_order_transactions','List order transactions with date, order and pagination filters','GET','/transaction/order-list',z.object({...dates,...page,pw_order_id:str.optional(),order_name:str.optional()}).strict(),true,{query:true}),
 op('list_transactions','List account transactions with invoice, gateway, status and type filters','GET','/transaction/list',z.object({...dates,...page,invoice:text.optional(),paymentGateway:text.optional(),status:text.optional(),type:text.optional()}).strict(),true,{query:true}),
];
