from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.sql import func
from .database import Base

class AlarmHistory(Base):
    __tablename__ = "alarm_history"

    id = Column(Integer, primary_key=True, index=True)
    op_name = Column(String, index=True)
    station_name = Column(String, index=True)
    message = Column(String)
    count = Column(Integer, default=1)

    occured_time = Column(DateTime)
    cleared_time = Column(DateTime, nullable=True)
    start_time = Column(DateTime, nullable=True)

    reset_time = Column(String, default="")
    recovery_time = Column(String, default="")

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

class AppSetting(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    target_mode = Column(String, default="manual")
    manual_target_value = Column(Integer, default=500)
    ideal_cycle_time = Column(Float, default=10.0)
    stop_detection_multiplier = Column(Float, default=1.0)
    
class TimelineHistory(Base):
    __tablename__ = "timeline_history"

    id = Column(Integer, primary_key=True, index=True)
    machine_name = Column(String, index=True)
    shift = Column(String, index=True)  # day / night
    block_index = Column(Integer)
    status = Column(String)


class ChartHistory(Base):
    __tablename__ = "chart_history"

    id = Column(Integer, primary_key=True, index=True)
    shift = Column(String, index=True)
    label = Column(String, index=True)
    good_qty = Column(Integer, default=0)
    ng_qty = Column(Integer, default=0)
    updated_at = Column(DateTime)


class HourlyHistory(Base):
    __tablename__ = "hourly_history"

    id = Column(Integer, primary_key=True, index=True)
    shift = Column(String, index=True)
    slot_key = Column(String, index=True)
    start_good = Column(Integer, default=0)
    start_ng = Column(Integer, default=0)
    updated_at = Column(DateTime)
