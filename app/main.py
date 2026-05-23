from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    if len(machines) < 13:
        existing_names = [m.name for m in machines]
        import random
        statuses = ["RUN", "STANDBY", "STOP"]
        for i in [1, 2, 5, 7, 8, 9, 10, 11, 12, 13]:
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

@app.get("/api/settings")
def get_settings(db: Session = Depends(database.get_db)):
    setting = db.query(models.AppSetting).filter(models.AppSetting.id == 1).first()

    if not setting:
        setting = models.AppSetting(
            id=1,
            target_mode="manual",
            manual_target_value=500,
            ideal_cycle_time=10.0,
            stop_detection_multiplier=1.0
        )
        db.add(setting)
        db.commit()
        db.refresh(setting)

    return {
        "targetMode": setting.target_mode,
        "manualTargetValue": setting.manual_target_value,
        "idealCycleTime": setting.ideal_cycle_time,
        "stopDetectionMultiplier": setting.stop_detection_multiplier
    }


@app.post("/api/settings")
def save_settings(settings: dict, db: Session = Depends(database.get_db)):
    setting = db.query(models.AppSetting).filter(models.AppSetting.id == 1).first()

    if not setting:
        setting = models.AppSetting(id=1)
        db.add(setting)

    setting.target_mode = settings.get("targetMode", "manual")
    setting.manual_target_value = int(settings.get("manualTargetValue", 500))
    setting.ideal_cycle_time = float(settings.get("idealCycleTime", 10.0))
    setting.stop_detection_multiplier = float(settings.get("stopDetectionMultiplier", 1.0))

    db.commit()
    db.refresh(setting)

    return {
        "message": "Settings saved successfully",
        "targetMode": setting.target_mode,
        "manualTargetValue": setting.manual_target_value,
        "idealCycleTime": setting.ideal_cycle_time,
        "stopDetectionMultiplier": setting.stop_detection_multiplier
    }

@app.get("/api/timeline")
def get_timeline(db: Session = Depends(database.get_db)):
    rows = db.query(models.TimelineHistory).all()

    result = {}

    for r in rows:
        if r.machine_name not in result:
            result[r.machine_name] = {
                "day": [None] * 360,
                "night": [None] * 360
            }

        result[r.machine_name][r.shift][r.block_index] = r.status

    return result


@app.post("/api/timeline")
def save_timeline(data: dict, db: Session = Depends(database.get_db)):
    machine_name = data.get("machineName")
    shift = data.get("shift")
    block_index = data.get("blockIndex")
    status = data.get("status")

    row = db.query(models.TimelineHistory).filter(
        models.TimelineHistory.machine_name == machine_name,
        models.TimelineHistory.shift == shift,
        models.TimelineHistory.block_index == block_index
    ).first()

    if not row:
        row = models.TimelineHistory(
            machine_name=machine_name,
            shift=shift,
            block_index=block_index,
            status=status
        )
        db.add(row)
    else:
        row.status = status

    db.commit()

    return {"message": "timeline saved"}


@app.delete("/api/timeline")
def clear_timeline(db: Session = Depends(database.get_db)):
    db.query(models.TimelineHistory).delete()
    db.commit()
    return {"message": "timeline cleared"}

from pydantic import BaseModel
from typing import Optional

class AlarmCreate(BaseModel):
    op_name: str
    station_name: str
    message: str = "Machine Alarm"


def format_duration(start, end):
    diff = end - start
    total_seconds = int(diff.total_seconds())

    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60

    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


@app.get("/api/alarms")
def get_alarms(db: Session = Depends(database.get_db)):
    alarms = db.query(models.AlarmHistory).order_by(models.AlarmHistory.id.desc()).all()
    return alarms


@app.post("/api/alarms")
def create_alarm(data: AlarmCreate, db: Session = Depends(database.get_db)):
    alarm = models.AlarmHistory(
        op_name=data.op_name,
        station_name=data.station_name,
        message=data.message,
        count=1,
        occured_time=datetime.now()
    )

    db.add(alarm)
    db.commit()
    db.refresh(alarm)

    return alarm


@app.post("/api/alarms/{machine_name}/reset")
def reset_alarm(machine_name: str, db: Session = Depends(database.get_db)):
    alarm = db.query(models.AlarmHistory)

@app.post("/api/alarms/{machine_name}/run")
def run_alarm(machine_name: str, db: Session = Depends(database.get_db)):
    alarm = db.query(models.AlarmHistory).filter(
        models.AlarmHistory.station_name == machine_name,
        models.AlarmHistory.start_time == None
    ).order_by(models.AlarmHistory.id.desc()).first()

    if not alarm:
        return {"message": "No alarm waiting for run"}

    now = datetime.now()

    alarm.start_time = now
    alarm.recovery_time = format_duration(alarm.occured_time, now)

    db.commit()
    db.refresh(alarm)

    return alarm