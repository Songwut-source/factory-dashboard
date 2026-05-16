from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.sql import func
from .database import Base

class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True) # e.g., "AS001"
    status = Column(String, default="STOP") # RUN, STOP, ALARM
    current_good_count = Column(Integer, default=0)
    current_ng_count = Column(Integer, default=0)
    ideal_cycle_time = Column(Float, default=1.0) # seconds per part

class ProductionData(Base):
    __tablename__ = "production_data"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"))
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    good_qty = Column(Integer)
    ng_qty = Column(Integer)
    total_qty = Column(Integer)
    shift = Column(String)

class AlarmLog(Base):
    __tablename__ = "alarm_logs"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"))
    alarm_code = Column(String)
    description = Column(String)
    start_time = Column(DateTime(timezone=True), server_default=func.now())
    end_time = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True) # Calculated when alarm ends
    is_loss_time = Column(Boolean, default=True) # Whether it should be deducted from OEE
