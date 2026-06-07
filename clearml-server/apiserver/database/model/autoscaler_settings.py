from mongoengine import (
    Document,
    StringField,
    DateTimeField,
)

from apiserver.database import Database, strict
from apiserver.database.model import DbModelMixin


class AutoscalerSettings(DbModelMixin, Document):
    meta = {
        "db_alias": Database.backend,
        "strict": strict,
        "indexes": [
            "company"
        ],
    }

    id = StringField(primary_key=True)
    company = StringField(required=True, unique=True)
    last_update = DateTimeField()
    connection_method = StringField(default="openshift")
    openshift_login_mode = StringField(default="fields")
    openshift_api_url = StringField()
    openshift_token = StringField()
    openshift_login_command = StringField()
    runai_access_key = StringField()
    runai_secret_key = StringField()
    runai_cluster = StringField()
    runai_project = StringField()
    runai_cli_version = StringField(default="auto")
    user = StringField()
    worker = StringField()


class AutoscalerExecution(DbModelMixin, Document):
    meta = {
        "db_alias": Database.backend,
        "strict": strict,
        "indexes": [
            "company",
            "-created",
        ],
    }

    id = StringField(primary_key=True)
    company = StringField(required=True)
    created = DateTimeField()
    status = StringField(default="pending")
    operation = StringField(default="submit")
    workload_type = StringField()
    workload_name = StringField()
    workload_params = StringField()
    stdout = StringField()
    stderr = StringField()
    return_code = StringField()
    user = StringField()
    worker = StringField()


class AutoscalerAppInstance(DbModelMixin, Document):
    meta = {
        "db_alias": Database.backend,
        "strict": strict,
        "indexes": [
            "company",
            "name",
            ("company", "project", "name"),
            "-created",
        ],
    }

    id = StringField(primary_key=True)
    company = StringField(required=True)
    created = DateTimeField()
    last_update = DateTimeField()
    name = StringField(required=True)
    project = StringField()
    workload_type = StringField()
    status = StringField(default="saved")
    workload_params = StringField()
    source = StringField(default="ui")
    user = StringField()
    worker = StringField()
