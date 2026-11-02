function assertSafeDemoSeed(env=process.env){
  if(env.NODE_ENV!=="development"||env.SEASONKART_ALLOW_DEMO_SEED!=="1"){
    throw new Error("Demo seeding is disabled. Set NODE_ENV=development and SEASONKART_ALLOW_DEMO_SEED=1 only for a disposable development database.");
  }
  if(!env.DB_NAME||!env.DB_USER)throw new Error("Set DB_NAME and DB_USER in .env first.");
  if(/prod|live/i.test(env.DB_NAME))throw new Error("Refusing to seed a database name that appears to be production or live.");
  return true;
}

module.exports={assertSafeDemoSeed};
