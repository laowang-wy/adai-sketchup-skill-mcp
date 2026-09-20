'use strict';
const {toolkitTool}=require('./toolkit-registry');
async function ancientTool(input,appData){const {action,...args}=input;return toolkitTool({action:'invoke',toolkit_id:'ancient-architecture',operation:action,arguments:args},appData);}
module.exports={ancientTool};
