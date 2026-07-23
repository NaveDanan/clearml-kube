from apiserver.apimodels.notifications import (
    SubscribeRequest,
    SubscribeResponse,
    UnsubscribeRequest,
    UnsubscribeResponse,
    GetSubscriptionsRequest,
)
from apiserver.bll.notifications import NotificationBLL
from apiserver.service_repo import APICall, endpoint


@endpoint(
    "notifications.subscribe",
    request_data_model=SubscribeRequest,
    response_data_model=SubscribeResponse,
)
def subscribe(call: APICall, company_id: str, request: SubscribeRequest):
    """Subscribe the calling user to email notifications for an entity."""
    sub_id = NotificationBLL.subscribe(
        company=company_id,
        user=call.identity.user,
        entity_type=request.entity_type,
        entity_id=request.entity,
        events=request.events,
    )
    call.result.data_model = SubscribeResponse(id=sub_id)


@endpoint(
    "notifications.unsubscribe",
    request_data_model=UnsubscribeRequest,
    response_data_model=UnsubscribeResponse,
)
def unsubscribe(call: APICall, company_id: str, request: UnsubscribeRequest):
    """Remove the calling user's subscription for an entity."""
    deleted = NotificationBLL.unsubscribe(
        company=company_id,
        user=call.identity.user,
        entity_type=request.entity_type,
        entity_id=request.entity,
    )
    call.result.data_model = UnsubscribeResponse(deleted=deleted)


@endpoint(
    "notifications.get_subscriptions",
    request_data_model=GetSubscriptionsRequest,
)
def get_subscriptions(call: APICall, company_id: str, request: GetSubscriptionsRequest):
    """List the calling user's notification subscriptions."""
    subscriptions = NotificationBLL.get_subscriptions(
        company=company_id,
        user=call.identity.user,
        entity_type=request.entity_type,
        entity_id=request.entity,
    )
    call.result.data = {"subscriptions": subscriptions}
