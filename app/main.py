from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
import os
import pandas as pd
from datetime import datetime

from . import models, database

# Create tables
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="Smart Production Line API (AS001)")

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def home():
    return FileResponse("static/index.html")

# Ensure static directory exists
os.makedirs("static", exist_ok=True)
if not os.path.exists("static/index.html"):
    with open("static/index.html", "w", encoding="utf-8") as f:
        f.write("<h1>Smart Production Line Dashboard Loading...</h1>")

# Serve static files (Frontend Dashboard)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
def read_root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/api/machine/{machine_name}")
def get_machine_status(machine_name: str, db: Session = Depends(database.get_db)):
    machine = db.query(models.Machine).filter(models.Machine.name == machine_name).first()
    if not machine:
        machine = models.Machine(name=machine_name, status="STOP", current_good_count=0, current_ng_count=0)
        db.add(machine)
        db.commit()
        db.refresh(machine)
    return machine

@app.post("/api/machine/{machine_name}/update")
def update_machine_data(machine_name: str, status: str, good_qty: int, ng_qty: int, db: Session = Depends(database.get_db)):
    machine = db.query(models.Machine).filter(models.Machine.name == machine_name).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    
    machine.status = status
    machine.current_good_count = good_qty
    machine.current_ng_count = ng_qty
    db.commit()
    db.refresh(machine)
    return machine

# OEE Calculation endpoint
@app.get("/api/machine/{machine_name}/oee")
def calculate_oee(machine_name: str, db: Session = Depends(database.get_db)):
    machine = db.query(models.Machine).filter(models.Machine.name == machine_name).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    
    total = machine.current_good_count + machine.current_ng_count
    # Mock Availability and Performance for Phase 1
    availability = 0.85 # 85%
    performance = 0.90  # 90%
    quality = (machine.current_good_count / total) if total > 0 else 1.0
    
    oee = availability * performance * quality
    
    return {
        "availability": round(availability * 100, 2),
        "performance": round(performance * 100, 2),
        "quality": round(quality * 100, 2),
        "oee": round(oee * 100, 2)
    }

@app.get("/api/report/export")
def export_report(db: Session = Depends(database.get_db)):
    machine = db.query(models.Machine).filter(models.Machine.name == "AS001").first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
        
    total = machine.current_good_count + machine.current_ng_count
    
    # Create DataFrame for Excel
    data = {
        "Machine Name": [machine.name],
        "Status": [machine.status],
        "Good Qty": [machine.current_good_count],
        "NG Qty": [machine.current_ng_count],
        "Total Qty": [total],
        "Export Date": [datetime.now().strftime("%Y-%m-%d %H:%M:%S")]
    }
    df = pd.DataFrame(data)
    
    file_path = "static/AS001_Report.xlsx"
    df.to_excel(file_path, index=False)
    
    return FileResponse(
        path=file_path, 
        filename=f"AS001_Report_{datetime.now().strftime('%Y%m%d')}.xlsx", 
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.get("/api/machines")
def get_all_machines(db: Session = Depends(database.get_db)):
    machines = db.query(models.Machine).all()
    if len(machines) < 10:
        existing_names = [m.name for m in machines]
        import random
        statuses = ["RUN", "STANDBY", "STOP"]
        for i in range(1, 11):
            name = f"OP{i}"
            if name not in existing_names:
                new_machine = models.Machine(
                    name=name, 
                    status=random.choice(statuses), 
                    current_good_count=random.randint(0, 100), 
                    current_ng_count=random.randint(0, 5)
                )
                db.add(new_machine)
        db.commit()
        machines = db.query(models.Machine).all()
    return machines

@app.post("/api/machines/simulate")
def simulate_all_machines(db: Session = Depends(database.get_db)):
    import random
    machines = db.query(models.Machine).filter(models.Machine.name.startswith("OP")).all()
    statuses = ["RUN", "RUN", "RUN", "STANDBY", "STOP"] # Weighted for realistic look
    for m in machines:
        m.status = random.choice(statuses)
    db.commit()
    return {"status": "ok"}
