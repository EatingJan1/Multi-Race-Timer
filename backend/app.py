import datetime
import json
import os
from functools import wraps
from flask import Flask, request, jsonify, send_file, session, abort
from flask_restx import Resource, Api, Namespace, fields
from flask_cors import CORS
import io
import csv

app = Flask(__name__)
# IMPORTANT: Set a secret key for session management!
# In production, use os.environ.get('SECRET_KEY')
app.secret_key = os.environ.get('SECRET_KEY', 'super-secret-key-change-me')

# Allow CORS with credentials (cookies)
CORS(app, supports_credentials=True)

api = Api(app, version='1.0', title='Multi-Race Timer API', description='API for tracking multiple race sessions')

ns = api.namespace('race', description='Race operations')
auth_ns = api.namespace('auth', description='Authentication')

DATA_DIR = 'data'
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

#USERS_FILE = os.path.join(DATA_DIR, 'users.json')
USERS_FILE = 'users.json'

def load_users():
    if not os.path.exists(USERS_FILE):
        # Create default admin user if file doesn't exist
        default_users = {
            os.environ.get('ADMIN_USER', 'admin'): os.environ.get('ADMIN_PASS', 'password')
        }
        print("Creating default admin user: " + os.environ.get('ADMIN_USER', 'admin'))
        with open(USERS_FILE, 'w') as f:
            json.dump(default_users, f, indent=4)
        return default_users
    
    try:
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {}

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return {'message': 'Authentication required'}, 401
        return f(*args, **kwargs)
    return decorated_function

# Authentication Endpoints
@auth_ns.route('/login')
class Login(Resource):
    def post(self):
        """Login to the application"""
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        users = load_users()
        
        if username in users and users[username] == password:
            session['logged_in'] = True
            session['user'] = username
            print("Login successful for user: " + username)

            session.permanent = True  # Make cookie persistent
            return {'status': 'success', 'message': 'Logged in successfully'}, 200
        
        return {'status': 'error', 'message': 'Invalid credentials'}, 401

@auth_ns.route('/logout')
class Logout(Resource):
    def post(self):
        """Logout from the application"""
        session.pop('logged_in', None)
        return {'status': 'success', 'message': 'Logged out successfully'}, 200

@auth_ns.route('/status')
class AuthStatus(Resource):
    def get(self):
        """Check authentication status"""
        if session.get('logged_in'):
            return {'logged_in': True, 'user': ADMIN_USER}
        return {'logged_in': False}, 200


def get_race_path(race_name):
    # Ensure safe filename
    safe_name = "".join([c for c in race_name if c.isalnum() or c in ('.', '_', '-')]).rstrip()
    if not safe_name.endswith('.json'):
        safe_name += '.json'
    return os.path.join(DATA_DIR, safe_name)

def load_data(race_name):
    path = get_race_path(race_name)
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return {"people": []}

def save_data(race_name, data):
    path = get_race_path(race_name)
    with open(path, 'w') as f:
        json.dump(data, f, indent=4)

person_model = api.model('Person', {
    'id': fields.String(required=True),
    'name': fields.String(required=True),
    'start_number': fields.Integer(required=True),
    'tags': fields.List(fields.String()), # New tags field
    'start_time': fields.String(),
    'end_time': fields.String(),
    'duration': fields.Float()
})

# Apply login_required to all race operations
@ns.route('/list')
class RaceList(Resource):
    @login_required
    def get(self):
        """List all available race files"""
        files = [f.replace('.json', '') for f in os.listdir(DATA_DIR) if f.endswith('.json')]
        return sorted(files, reverse=True)

@ns.route('/<string:race_name>/people')
class PersonList(Resource):
    @ns.marshal_list_with(person_model)
    @login_required
    def get(self, race_name):
        """List all people in a specific race"""
        data = load_data(race_name)
        return data['people']

    @login_required
    def post(self, race_name):
        """Import people into a specific race"""
        people = request.json
        data = {"people": people}
        save_data(race_name, data)
        return data['people'], 201

@ns.route('/<string:race_name>/full')
class FullData(Resource):
    @login_required
    def get(self, race_name):
        """Get full race data as JSON"""
        return load_data(race_name)

    @login_required
    def post(self, race_name):
        """Upload full race data as JSON"""
        data = request.json
        save_data(race_name, data)
        return data, 201

@ns.route('/<string:race_name>/start/<int:start_number>')
class StartPerson(Resource):
    @login_required
    def post(self, race_name, start_number):
        data = load_data(race_name)
        # Use client timestamp if provided, else server time
        timestamp = request.json.get('timestamp') if request.is_json else None
        if not timestamp:
            timestamp = datetime.datetime.now().isoformat()
            
        found = False
        for person in data['people']:
            if person['start_number'] == start_number:
                person['start_time'] = timestamp
                person['end_time'] = None
                person['duration'] = None
                found = True
                break
        if not found: api.abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'started', 'timestamp': timestamp}

@ns.route('/<string:race_name>/stop/<int:start_number>')
class StopPerson(Resource):
    @login_required
    def post(self, race_name, start_number):
        data = load_data(race_name)
        # Use client timestamp if provided, else server time
        timestamp = request.json.get('timestamp') if request.is_json else None
        if not timestamp:
            timestamp = datetime.datetime.now().isoformat()
            
        found = False
        for person in data['people']:
            if person['start_number'] == start_number:
                if 'start_time' not in person or not person['start_time']:
                    api.abort(400, "Not started")
                person['end_time'] = timestamp
                start_dt = datetime.datetime.fromisoformat(person['start_time'])
                end_dt = datetime.datetime.fromisoformat(timestamp)
                person['duration'] = (end_dt - start_dt).total_seconds()
                found = True
                break
        if not found: api.abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'stopped', 'timestamp': timestamp}

@ns.route('/<string:race_name>/delete')
class DeleteRace(Resource):
    @login_required
    def delete(self, race_name):
        """Delete a race file"""
        path = get_race_path(race_name)
        if os.path.exists(path):
            os.remove(path)
            return {'status': 'deleted'}
        api.abort(404)

@ns.route('/<string:race_name>/export')
class ExportRace(Resource):
    # Depending on requirements, export might not need login or is strictly checked.
    # Assuming login is needed for safety.
    @login_required
    def get(self, race_name):
        """Export race data as CSV"""
        data = load_data(race_name)
        si = io.StringIO()
        cw = csv.writer(si)
        cw.writerow(['Name', 'Startnummer', 'Tags', 'Startzeit', 'Endzeit', 'Dauer (s)'])
        for p in data['people']:
            tags_str = ",".join(p.get('tags', []))
            cw.writerow([p['name'], p['start_number'], tags_str, p['start_time'] or '', p['end_time'] or '', p['duration'] or ''])
        
        output = io.BytesIO()
        output.write(si.getvalue().encode('utf-8'))
        output.seek(0)
        return send_file(output, mimetype='text/csv', as_attachment=True, download_name=f"{race_name}_ergebnisse.csv")

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
