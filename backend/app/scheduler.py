from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings

scheduler = BackgroundScheduler(timezone=settings.scan_timezone)


def register_jobs(scan_func):
    scheduler.add_job(scan_func, CronTrigger(day_of_week="mon-fri", hour=6, minute=0), id="premarket")
    scheduler.add_job(scan_func, CronTrigger(day_of_week="mon-fri", hour=9, minute=45), id="open")
    scheduler.add_job(scan_func, CronTrigger(day_of_week="mon-fri", hour=12, minute=30), id="midday")
    scheduler.add_job(scan_func, CronTrigger(day_of_week="mon-fri", hour=15, minute=15), id="power_hour")
    scheduler.add_job(scan_func, CronTrigger(day_of_week="mon-fri", hour=16, minute=15), id="eod")
    scheduler.add_job(scan_func, CronTrigger(day_of_week="sat", hour=9, minute=0), id="weekend")
