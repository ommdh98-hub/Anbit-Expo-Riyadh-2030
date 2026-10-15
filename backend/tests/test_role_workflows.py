"""Audience permissions exercise real endpoints against the isolated test fixture."""
from datetime import datetime, timezone
from uuid import uuid4
import pytest
from test_api import client, as_role, reading


@pytest.mark.parametrize('role', ['user', 'survey'])
@pytest.mark.parametrize('path', [
    '/api/auth/me', '/api/sites', '/api/zones', '/api/zones/z3',
    '/api/zones/z3/measurements', '/api/zones/z3/coverage',
    '/api/zones/z3/next-measurement', '/api/zones/z3/inspections',
    '/api/plants', '/api/recommendations', '/api/irrigation-events', '/api/reports/water',
])
def test_both_audiences_can_read_shared_information(client, role, path):
    as_role(client, role)
    assert client.get(path).status_code == 200


@pytest.mark.parametrize('role', ['user', 'survey'])
def test_both_audiences_can_calculate_without_saving(client, role):
    as_role(client, role)
    before = client.get('/api/zones/z3').json()
    assumptions = dict(irrigated_area_m2=400, root_depth_m=.2, efficiency=.8)
    assert client.post('/api/zones/z3/estimate', json={**assumptions, 'root_representative': True, 'homogeneous': True}).status_code == 200
    assert client.post('/api/zones/z3/simulate', json={**assumptions, 'volume_l': 1000}).status_code == 200
    after = client.get('/api/zones/z3').json()
    assert after['revision'] == before['revision']
    assert after['measurements'] == before['measurements']
    assert client.get('/api/reports/water').json()['events_count'] == 0


def test_individual_cannot_change_professional_site_data(client):
    recommendation = client.post('/api/zones/z3/recommendations').json()
    as_role(client, 'user')
    operations = [
        ('post', '/api/zones/z3/measurements', reading(point_id='z3-p1')),
        ('post', '/api/zones/z3/inspections', {'notes': 'test inspection'}),
        ('post', '/api/zones/z3/recommendations', {}),
        ('patch', f"/api/recommendations/{recommendation['id']}", {'status': 'approved'}),
        ('post', '/api/irrigation-events', {}),
        ('delete', '/api/zones/z3', {}),
    ]
    before = client.get('/api/zones/z3').json()
    for method, path, body in operations:
        assert client.request(method.upper(), path, json=body).status_code == 403
    after = client.get('/api/zones/z3').json()
    assert after['revision'] == before['revision']
    assert after['measurements'] == before['measurements']


def test_landscape_complete_workflow_without_permission_errors(client):
    before = client.get('/api/zones/z1').json()
    suggested = before['decision']['coverage']['next_point']
    result = client.post('/api/zones/z1/measurements', json=reading(x=suggested['x'], y=suggested['y']))
    assert result.status_code == 201
    after = result.json()
    assert {m['id'] for m in before['measurements']} < {m['id'] for m in after['measurements']}
    assert after['decision']['coverage']['active_points'] > before['decision']['coverage']['active_points']
    assert client.post('/api/zones/z1/inspections', json={'id': str(uuid4()), 'notes': 'isolated test inspection', 'operator': 'test'}).status_code == 201
    rec = client.post('/api/zones/z3/recommendations')
    assert rec.status_code == 200
    rec_id = rec.json()['id']
    assert client.patch(f'/api/recommendations/{rec_id}', json={'status': 'approved', 'operator': 'test'}).status_code == 200
    event = {'id': str(uuid4()), 'recommendation_id': rec_id, 'volume': 100,
             'unit': 'L', 'volume_kind': 'measured', 'executed_at': datetime.now(timezone.utc).isoformat(), 'operator': 'test'}
    assert client.post('/api/irrigation-events', json=event).status_code == 201
    report = client.get('/api/reports/water').json()
    assert report['events_count'] == 1
    assert report['total_l'] == 100
    assert client.get('/api/plants').status_code == 200


@pytest.mark.parametrize('role', ['user', 'survey'])
def test_reset_requires_separate_maintenance_authorization(client, role, monkeypatch):
    as_role(client, role)
    before = client.get('/api/zones/z3').json()
    monkeypatch.delenv('ANBIT_MAINTENANCE_TOKEN', raising=False)
    assert client.post('/api/demo/reset').status_code == 403
    monkeypatch.setenv('ANBIT_MAINTENANCE_TOKEN', 'isolated-test-maintenance-token-32chars')
    assert client.post('/api/demo/reset').status_code == 403
    assert client.post('/api/demo/reset', headers={'X-Anbit-Maintenance-Key': 'incorrect'}).status_code == 403
    assert client.get('/api/zones/z3').json()['measurements'] == before['measurements']


def test_profile_uses_current_audience_labels_without_updating_accounts(client):
    from sqlmodel import Session
    from app import main
    from app.auth import AnbitAccount
    with Session(main.engine) as session:
        account = session.get(AnbitAccount, 'survey')
        account.display_name = 'legacy label'
        previous_hash = account.password_hash
        session.add(account)
        session.commit()
    as_role(client, 'survey')
    assert client.get('/api/auth/me').json()['name'] == 'فرق المسطحات الخضراء'
    with Session(main.engine) as session:
        account = session.get(AnbitAccount, 'survey')
        assert account.display_name == 'legacy label'
        assert account.password_hash == previous_hash
