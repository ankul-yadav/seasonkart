function isPayoutEligible({status,payment_method,payment_status,delivered_at,ret_days,cod_remitted_at,return_status,now=new Date(),minimumDays=7}){
  if(status!=="Delivered"||!delivered_at)return false;
  if(return_status!=null&&return_status!=="rejected")return false;
  if(payment_method==="online"&&payment_status!=="paid")return false;
  if(payment_method==="cod"&&(payment_status!=="cod"||!cod_remitted_at))return false;
  if(!["online","cod"].includes(payment_method))return false;
  const days=Math.max(minimumDays,Number.isInteger(ret_days)?ret_days:minimumDays);
  return new Date(delivered_at).getTime()+days*86400000<=new Date(now).getTime();
}

function calculateSupplierPayout(gross,orderGross,orderDiscount){
  if(![gross,orderGross,orderDiscount].every(Number.isFinite)||gross<0||orderGross<0||orderDiscount<0)throw new Error("Payout amounts must be finite and non-negative");
  const discount=Math.min(gross,orderGross>0?orderDiscount*gross/orderGross:0);
  const base=Math.max(0,Math.round((gross-discount)*100)/100);
  const commission=Math.round(base*20)/100;
  return{gross,discount:Math.round(discount*100)/100,base,commission,payable:Math.round((base-commission)*100)/100};
}

function isValidPayoutAdjustment({amount,direction,reason,available}){
  if(!Number.isFinite(amount)||amount<=0||amount>100000000||!["debit","credit"].includes(direction)||typeof reason!=="string"||reason.trim().length<8)return false;
  const cents=Math.round(amount*100);
  if(!Number.isSafeInteger(cents)||Math.abs(cents-amount*100)>1e-7)return false;
  return direction!=="debit"||amount<=available;
}

function netPayoutAdjustments(adjustments){
  return adjustments.reduce((net,item)=>{
    if(!Number.isFinite(Number(item.amount))||!["debit","credit"].includes(item.direction))throw new Error("Invalid payout adjustment record");
    return net+(item.direction==="debit"?-1:1)*Number(item.amount);
  },0);
}

module.exports={isPayoutEligible,calculateSupplierPayout,isValidPayoutAdjustment,netPayoutAdjustments};
