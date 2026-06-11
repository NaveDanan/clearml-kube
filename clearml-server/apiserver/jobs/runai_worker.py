"""Background worker that processes queued autoscaler executions."""
import os
from pathlib import Path
from time import sleep

from apiserver.bll.autoscaler import AutoscalerBLL
from apiserver.config_repo import config
from apiserver.database import db

log = config.logger(f"JOB-{Path(__file__).name}")

POLL_INTERVAL = int(os.environ.get("RUNAI_WORKER_POLL_INTERVAL", "10"))
MAX_EXECUTIONS_PER_POLL = int(os.environ.get("RUNAI_WORKER_BATCH_SIZE", "5"))

autoscaler_bll = AutoscalerBLL()


def process_pending():
    """Claim and process pending executions."""
    processed = 0

    while processed < MAX_EXECUTIONS_PER_POLL:
        execution = autoscaler_bll.claim_pending_execution()
        if not execution:
            break

        log.info(
            f"Processing execution {execution.id} "
            f"(type={execution.workload_type}, name={execution.workload_name})"
        )

        try:
            result = autoscaler_bll.process_execution(execution)
        except Exception as ex:
            log.exception(f"Failed processing execution {execution.id}")
            try:
                result = autoscaler_bll._fail_execution(execution, str(ex))
            except Exception:
                log.exception(f"Failed marking execution {execution.id} as failed")
                result = {"status": "error", "return_code": ""}

        log.info(
            f"Finished execution {execution.id} with status={result.get('status')} "
            f"return_code={result.get('return_code', '')}"
        )
        processed += 1

    return processed


def main():
    db.initialize()
    log.info("Run:ai worker started")

    while True:
        try:
            processed = process_pending()
            if processed:
                log.info(f"Processed {processed} autoscaler execution(s)")
        except Exception:
            log.exception("Error in runai_worker loop")
        sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
