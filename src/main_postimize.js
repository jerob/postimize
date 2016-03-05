import _ from 'lodash';
import { Promise, default as Q } from 'q';
import craft from './lib/craft-ai';
import fs from 'fs';
import jsdom from 'jsdom';
import Moment from 'moment';
import retrieveNearestPostOffices from './lib/postOffices';
import ToJson from 'togeojson';
import program from 'commander';
import path from 'path';

const AGENT_MODEL = {
  knowledge: {
    dayOfTheWeek: {
      type: 'discrete',
      min: 1,
      max: 7
    },
    timeOfDay:  {
      type: 'continuous',
      min: 0,
      max: 24
    },
    delivery: {
      type: 'enum_output'
    }
  }
};


function generateData() {
  // [Day - Hour - Delivered] 

  var data = [
    [1, 13.2, 1],
    [1, 13.3, 1],
    [1, 13.4, 1],
    [1, 13.7, 1],
    [1, 17, 1],
    
    [2, 10.4, 1],
    [2, 10.5, 1],
    [2, 10.6, 1],
    [2, 10.7, 1]
  ]
  var gData = []

  let counter = 0
  while(counter < _.first(data)[1] - 0.1) {
    gData.push([_.first(data)[0], counter, 0])
    counter += 0.1
  }

  _.forEach(data, (value, key) => {

     if (key != 0) {
        gData.push(data[key - 1])
        
        // add positive samples
                  

        let lastDay = data[key - 1][0]
        let lastHour = data[key - 1][1]
        
        let currentDay = value[0]
        let currentHour = value[1]

        if (lastDay == currentDay & currentHour - lastHour > 0.1) {
          let counter = lastHour + 0.1
          while(counter < currentHour - 0.1) {
            gData.push([currentDay, counter, 0])
            counter += 0.1
          }
        }

        if (lastDay != currentDay) {
          let counter = lastHour + 0.1
          while(counter < 24) {
            gData.push([lastDay, counter, 0])
            counter += 0.1
          }
          counter = 0
          while(counter < currentHour - 0.1) {
            gData.push([currentDay, counter, 0])
            counter += 0.1
          }
        }

     }
  })
  
  gData.push(_.last(data))

  counter = _.last(data)[1] + 0.1
  while(counter < 24) {
    gData.push([_.last(data)[0], counter, 0])
    counter += 0.1
  }
  

  let diffs = []
  _.forEach(gData, (value, key) => {
      diffs.push({
        "timestamp": Math.floor(value[1] * 3600 + value[0] * 24 * 3600),
        "diff": {
          "dayOfTheWeek": value[0],
          "timeOfDay": value[1].toFixed(1),
          "delivery": value[2]
        }
      })
  })
  //console.log(diffs)
  return diffs

}

function postimize() {
  
  craft.createAgent(AGENT_MODEL)
      .then(agent => {
        console.log(`Agent '${agent.id}' successfully created.`);
        return craft.updateAgentContext(agent.id, generateData()).then(() => {
          console.log(`- Inspect the decision tree at https://labs-integration.craft.ai/inspector?owner=laposte&agentId=${agent.id}&token=${process.env.CRAFT_TOKEN}`);
          console.log(`npm start -- decide ${agent.id}`)
          console.log(`npm start -- crible ${agent.id}`)
        })
        .catch(err => console.log(err))
      })
      .catch(err => console.log('Error while creating a new agent', err));
}

function crible(agent, dayOfTheWeek) {
  let promises = []
  let delivered = []
  _.range(9,18, 0.10).forEach((hour) => {
    let context = {
      dayOfTheWeek: dayOfTheWeek,
      timeOfDay: hour
    }
    promises.push(
        craft.getAgentDecision(agent, context, Moment().unix())
        .then(res => {
            delivered.push({delivered : res.result, hour : hour})
        })
    )
  })

  Promise.all(promises).then(() => {
    // console.log(_.sortBy(delivered, 'hour'));
    var positif = delivered.filter(function(item) {
      if(item.delivered=='1')
        return true;
    });
    var elmt = positif.map(function(item) {
        return item.hour;
    });
    var sum = 0;
    for( var i = 0; i < elmt.length; i++ ){
      sum += elmt[i];
    }
    var avg = Math.round(sum/elmt.length*100)/100;
    console.log(Math.floor(avg)+'h'+Math.round((avg % 1)/100*6000));
  })
}

program
  .command('decide <agent> [datetime]')
  .description('retrieve which post office in the right one at a given time')
  .action(function(agent, datetime) {
    const momentDatetime = _.isUndefined(datetime) ? Moment() : Moment(datetime);
    if (!momentDatetime.isValid()) {
      console.log('Error while parsing the given date/time ${datetime}');
      return;
    }
    const context = {
      dayOfTheWeek: momentDatetime.isoWeekday(),
      timeOfDay: parseFloat((momentDatetime.hour() + momentDatetime.minute()/60).toFixed(1)),
    }
    return craft.getAgentDecision(agent, context, momentDatetime.unix())
      .then(res => {
        console.log(`Decision at ${momentDatetime.format('lll')} for agent '${agent}' is `, res)
        console.log(`- Inspect the decision tree at https://labs-integration.craft.ai/inspector?owner=laposte&agentId=${agent}&token=${process.env.CRAFT_TOKEN}`);
      })
      .catch(err => {
        console.log(`Error while taking decision at ${momentDatetime.format('lll')} for agent '${agent}'`, err)
      });
  });

program
.command('postimize')
.description('postimize')
.action(function(options) {
  return postimize()
});

program
.command('crible')
.description('crible <agent> <dayOfTheWeek>')
.action(function(agent, dayOfTheWeek) {
  return crible(agent, dayOfTheWeek)
});


program.parse(process.argv);