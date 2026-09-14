/** Captions describe consequences. They never disclose scores or tell players whom to save. */
export const NPCS = {
  operator: {
    id: 'operator', name: 'MIRA SEN', role: 'GRID DISPATCH', associatedBlock: null,
    captions: {
      ready: ['One city. One reserve. Every decision matters.'],
      start: ['The reserve is yours. Follow the blinking blocks and match LOW, MEDIUM, or HIGH.'],
      warning: ['Demand is rising across the city. Keep watching the grid.'],
      multiple: ['Too many calls are coming in. People are waiting for power.'],
      storageLow: ['Our reserve is running low. Make every unit count.'],
      storageCritical: ["There is barely any power left. The whole grid is at risk."],
      saved: ['That connection is holding. Keep watching the rest of the city.'],
      lost: ['Another district has gone dark. It will stay offline for this shift.'],
      survived: ['Thank you. We kept the city running.'],
      collapse: ['The reserve is empty. The city has lost its last light.'],
      cityBlackout: ['Twenty-seven buildings have gone dark. This shift is over.'],
    },
  },
  hospital_worker: {
    id: 'hospital_worker', name: 'DR. ANIKA RAO', role: 'HOSPITAL WORKER', associatedBlock: 'hospital',
    captions: {
      warning: ["We're running on backup. Please keep the ICU online!", 'The monitors are flickering. We need a steady supply.'],
      ignored: ['Our backup cannot last much longer. We still need power!'],
      critical: ['The ICU is losing backup! Our patients need those machines!'],
      saved: ['The monitors are back. We can keep treating our patients.'],
      lost: ['We lost power at the hospital. The wards are dark.'],
      survived: ['Thank you. The hospital stayed online.'],
    },
  },
  water_worker: {
    id: 'water_worker', name: 'ARJUN DAS', role: 'WATER WORKER', associatedBlock: 'water',
    captions: {
      warning: ["The water pumps are struggling. People need water!", 'Pressure is dropping across the neighbourhood.'],
      ignored: ["We're almost out of reserve water. The pumps still need power!"],
      critical: ['The pumps are stopping! The tanks will run dry!'],
      saved: ['Water is flowing again. Thank you for keeping us running.'],
      lost: ['The pumps stopped. The water supply was affected.'],
      survived: ['The pumps stayed online. The city still has water.'],
    },
  },
  firefighter: {
    id: 'firefighter', name: 'KABIR ALI', role: 'FIRE OFFICER', associatedBlock: 'fire',
    captions: {
      warning: ['Our dispatch radios need power. We have crews out there.'],
      ignored: ['We are still on backup. We need to reach our crews.'],
      critical: ['The emergency lines are cutting out!'],
      saved: ['Dispatch is back. Our crews can hear us again.'],
      lost: ['The station went dark. Our response has been disrupted.'],
      survived: ['Our crews stayed connected through the night.'],
    },
  },
  teacher: {
    id: 'teacher', name: 'LEELA NAIR', role: 'TEACHER', associatedBlock: 'school',
    captions: {
      warning: ["The school is going dark. The children need light!", 'We are keeping the students together. Please keep us online.'],
      ignored: ['The children are still waiting in the dark.'],
      critical: ["The last classroom lights are going out!"],
      saved: ['The lights are back. The children feel safer now.'],
      lost: ['The school lost power. We had to stop our lessons.'],
      survived: ['Our classrooms stayed lit. Thank you.'],
    },
  },
  farmer: {
    id: 'farmer', name: 'DEV PATEL', role: 'FARMER', associatedBlock: 'farm',
    captions: {
      warning: ['The irrigation pump is failing. Please keep the farm running!', 'Our crops need water before this heat gets worse.'],
      ignored: ["We still do not have power. The fields are drying out."],
      critical: ["We're losing the crop! The irrigation has almost stopped!"],
      saved: ['The irrigation is working. The crop has a chance.'],
      lost: ['The pump stopped. We could not water the field.'],
      survived: ['At least our fields kept their water.'],
    },
  },
  resident: {
    id: 'resident', name: 'ISHITA ROY', role: 'RESIDENT', associatedBlock: 'residential',
    captions: {
      warning: ["Please do not let our block go dark!", "We've been worrying about the power all night."],
      ignored: ['Our neighbours are still waiting for the lights to return.'],
      critical: ['The whole street is flickering. Please, we need light!'],
      saved: ['Our lights are holding. We can see each other again.'],
      lost: ['Our block went dark. Everyone is waiting outside.'],
      survived: ['At least our homes stayed powered.'],
    },
  },
  factory_worker: {
    id: 'factory_worker', name: 'SAMEER KHAN', role: 'FACTORY WORKER', associatedBlock: 'factory',
    captions: {
      warning: ["The machines are shutting down. We're losing production!"],
      ignored: ['We are waiting to restart. The whole shift is standing still.'],
      critical: ['The line is stopping. We cannot finish this batch!'],
      saved: ['The machines are steady. We can finish our shift.'],
      lost: ['Production stopped. We sent the whole shift home.'],
      survived: ['The line kept running through the crisis.'],
    },
  },
  rail_worker: {
    id: 'rail_worker', name: 'NOOR MIRZA', role: 'STATION CONTROLLER', associatedBlock: 'rail',
    captions: {
      warning: ['The station signals are flickering. Passengers are waiting.'],
      ignored: ['Trains are held outside the station. We still need power.'],
      critical: ['The signals are going dark! We have to stop every train!'],
      saved: ['The signals are steady. We can get people moving.'],
      lost: ['The station shut down. Passengers have been stranded.'],
      survived: ['The last passengers made it home.'],
    },
  },
  shopkeeper: {
    id: 'shopkeeper', name: 'TARA MEHTA', role: 'SHOPKEEPER', associatedBlock: 'market',
    captions: {
      warning: ['The fridges are warming up. Please keep our shops running!'],
      ignored: ['Our shutters are half closed. We are still waiting for power.'],
      critical: ['Everything in cold storage is at risk!'],
      saved: ['The fridges are working again. We can keep the food fresh.'],
      lost: ['Our shops went dark. We could not stay open.'],
      survived: ['We kept the food cold and the doors open.'],
    },
  },
  technician: {
    id: 'technician', name: 'REHAN BOSE', role: 'DATA TECHNICIAN', associatedBlock: 'data',
    captions: {
      warning: ['The servers are switching to backup. Our cooling needs power.'],
      ignored: ['The racks are getting hot. We still need a stable supply.'],
      critical: ['We have to shut the servers down before they overheat!'],
      saved: ['The cooling is back. Our connections are holding.'],
      lost: ['The servers shut down. Connections across the city were interrupted.'],
      survived: ['The city stayed connected through the night.'],
    },
  },
};
