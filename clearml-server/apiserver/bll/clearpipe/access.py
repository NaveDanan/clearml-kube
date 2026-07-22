def can_read_definition(
    task_company: str,
    company_origin: str,
    requester_company: str,
    allow_public: bool = True,
) -> bool:
    """Defense-in-depth identity check applied after the database query."""
    return task_company == requester_company or (allow_public and task_company == "")


def can_write_definition(
    task_company: str,
    company_origin: str,
    requester_company: str,
) -> bool:
    return task_company == requester_company or (
        task_company == "" and company_origin == requester_company
    )

