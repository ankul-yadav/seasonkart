const MAX_PRICE=10000000;
const GST_RATES=[0,5,12,18,28];

function validPricePair(price,mrp){
  return Number.isFinite(price)&&Number.isInteger(price)&&price>0&&price<=MAX_PRICE
    &&Number.isFinite(mrp)&&Number.isInteger(mrp)&&mrp>=price&&mrp<=MAX_PRICE;
}

function taxMatchesCategory(category,gst,hsn){
  if(!category||!GST_RATES.includes(Number(gst))||!(/^\d{4,8}$/.test(String(category.hsn||""))))return false;
  if(Number(gst)!==Number(category.gst_rate))return false;
  return String(hsn||"")===String(category.hsn);
}

module.exports={MAX_PRICE,GST_RATES,validPricePair,taxMatchesCategory};
