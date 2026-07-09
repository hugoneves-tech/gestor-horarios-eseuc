import fs from "fs";

async function run() {
    const res = await fetch("http://localhost:3000/api/solver/simulate", {
       method: "POST",
       headers: {
         "Content-Type": "application/json"
       },
       body: JSON.stringify({
          ucs: [],
          docentes: [],
          salas: [],
          regras: []
       })
    });
    if (!res.ok) {
       console.log("Error:", await res.text());
       return;
    }
    const data = await res.json();
    console.log("Result entries count:", data.schedule.length);
}
run();
