const SUPPLIER_RANK={New:0,Accepted:1,Processing:2,Shipped:3};

function canSupplierTransition(current,next){
  if(current==="Delivered"||current==="Cancelled"||next==="Delivered")return false;
  if(!Object.hasOwn(SUPPLIER_RANK,current)||!Object.hasOwn(SUPPLIER_RANK,next))return false;
  return SUPPLIER_RANK[next]>=SUPPLIER_RANK[current];
}

function canAdminTransition(current,next){
  if(current===next)return false;
  if(current==="Processing")return next==="Shipped"||next==="Delivered";
  if(current==="Shipped")return next==="Delivered";
  return false;
}

function canVerifyDelivery(status,alreadyVerified){
  return !alreadyVerified&&(status==="Shipped"||status==="Delivered");
}

module.exports={canSupplierTransition,canAdminTransition,canVerifyDelivery};
