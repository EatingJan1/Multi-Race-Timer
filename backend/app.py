import datetime
import json
import os
from functools import wraps
from flask import Flask, request, jsonify, send_file, session, abort, make_response, send_from_directory
from flask_restx import Resource, Api, Namespace, fields
from flask_cors import CORS
import io
import csv
import subprocess

app = Flask(__name__)
# IMPORTANT: Set a secret key for session management!
# In production, use os.environ.get('SECRET_KEY')
app.secret_key = os.environ.get('SECRET_KEY', 'super-secret-key-change-me')

# Global CORS handling for all responses including errors
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = request.headers.get('Origin', '*')
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response

# Allow CORS with credentials (cookies)
CORS(app, supports_credentials=True)

version = subprocess.check_output(['git', 'describe', '--tags', '--abbrev=0'], stderr=subprocess.DEVNULL).decode('utf-8').strip()
api = Api(app, version=version, title='Multi-Race Timer API', description='API for tracking multiple race sessions')

ns = api.namespace('race', description='Race operations')
auth_ns = api.namespace('auth', description='Authentication')



DATA_DIR = 'data'
SIGNED_DIR = os.path.join(DATA_DIR, 'signed')

for d in [DATA_DIR, SIGNED_DIR]:
    if not os.path.exists(d):
        os.makedirs(d)

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

def get_app_version():
    try:
        # Get the latest git tag
        version = api.version
        return version
    except Exception:
        return "v1.0.0"

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
            return {'logged_in': True, 'user': session['user']}
        return {'logged_in': False}, 200


def get_race_path(race_name):
    # Ensure safe filename
    safe_name = "".join([c for c in race_name if c.isalnum() or c in ('.', '_', '-')]).rstrip()
    if not safe_name.endswith('.json'):
        safe_name += '.json'
    return os.path.join(DATA_DIR, safe_name)

def sanitize_pdf_filename(start_number, name):
    # Trim and replace multiple spaces with single underscore
    clean_name = "_".join(name.strip().split())
    # Remove any non-alphanumeric (keep underscores and dashes)
    clean_name = "".join([c for c in clean_name if c.isalnum() or c in ('_', '-')])
    return f"{start_number}_{clean_name}.pdf"

def load_data(race_name):
    path = get_race_path(race_name)
    if os.path.exists(path):
        with open(path, 'r') as f:
            data = json.load(f)
            # Ensure modern structure
            if "people" not in data: data["people"] = []
            if "settings" not in data:
                data["settings"] = {
                    "allow_registration": False,
                    "registration_stop": False,
                    "hidden": False,
                    "finished": False,
                    "form_config": []
                }
            if "registration_template" not in data:
                data["registration_template"] = None
            return data
    return {
        "people": [],
        "settings": {
            "allow_registration": False,
            "registration_stop": False,
            "hidden": False,
            "finished": False,
            "form_config": []
        },
        "registration_template": None
    }

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
        data = load_data(race_name)
        data['people'] = people
        save_data(race_name, data)
        return data['people'], 201

@ns.route('/<string:race_name>/settings')
class RaceSettings(Resource):
    @login_required
    def get(self, race_name):
        """Get race settings"""
        data = load_data(race_name)
        return data.get('settings', {})

    @login_required
    def post(self, race_name):
        """Update race settings"""
        settings = request.json
        data = load_data(race_name)
        data['settings'] = settings
        save_data(race_name, data)
        return data['settings'], 200


public_ns = api.namespace('public', description='Public operations')

@public_ns.route('/info')
class PublicInfo(Resource):
    def get(self):
        """Get public application information (version, etc.)"""
        return {
            'version': get_app_version(),
            'copyright': 'Jan Reiner'
        }


@public_ns.route('/races')
class PublicRaceList(Resource):
    def get(self):
        """List public races for landing page"""
        files = [f.replace('.json', '') for f in os.listdir(DATA_DIR) if f.endswith('.json')]
        public_races = []
        for race_name in files:
            data = load_data(race_name)
            settings = data.get('settings', {})
            if not settings.get('hidden', False):
                public_races.append({
                    'name': race_name,
                    'settings': settings,
                    'has_template': data.get('registration_template') is not None
                })
        return sorted(public_races, key=lambda x: x['name'], reverse=True)

@public_ns.route('/register/<string:race_name>')
class PublicRegister(Resource):
    def post(self, race_name):
        """Register for a race"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        
        if not settings.get('allow_registration', False) or settings.get('registration_stop', False):
            abort(403, "Registration is closed or not allowed")
            
        registration_data = request.json # Contains participant info
        signed_pdf_base64 = registration_data.get('signed_pdf') # Base64 of final PDF
        
        # Add person to race
        min_num = settings.get('start_num_min', 1)
        max_num = settings.get('start_num_max', 9999)
        
        used_numbers = [p['start_number'] for p in data['people']]
        
        # Find first available number in range
        start_num = min_num
        while start_num in used_numbers and start_num <= max_num:
            start_num += 1
            
        if start_num > max_num:
            abort(400, "Keine freien Startnummern mehr in diesem Bereich!")

        new_person = {
            'id': str(start_num),
            'name': registration_data.get('name'),
            'start_number': start_num,
            'tags': registration_data.get('tags', []),
            'start_time': None,
            'end_time': None,
            'duration': None
        }

        data['people'].append(new_person)
        save_data(race_name, data)
        
        # Save signed PDF if provided
        if signed_pdf_base64:
            import base64
            try:
                # Remove header if present
                if ',' in signed_pdf_base64:
                    signed_pdf_base64 = signed_pdf_base64.split(',')[1]
                
                pdf_data = base64.b64decode(signed_pdf_base64)
                
                # Race-specific subdirectory
                race_signed_dir = os.path.join(SIGNED_DIR, race_name)
                if not os.path.exists(race_signed_dir):
                    os.makedirs(race_signed_dir)
                    
                filename = sanitize_pdf_filename(new_person['start_number'], new_person['name'])
                save_path = os.path.join(race_signed_dir, filename)
                with open(save_path, 'wb') as f:
                    f.write(pdf_data)
            except Exception as e:
                print(f"Error saving signed PDF: {e}")
                
        return {'status': 'success', 'start_number': new_person['start_number']}, 201

@public_ns.route('/results/<string:race_name>')
class PublicParticipants(Resource):
    def get(self, race_name):
        """Get public participant list/results for a race"""
        data = load_data(race_name)
        # Return only people, sanitized if necessary (though current person object is public-friendly)
        return data.get('people', [])

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

@ns.route('/<string:race_name>/pdfs')
class SignedPdfList(Resource):
    @login_required
    def get(self, race_name):
        """List all signed PDFs for a race"""
        race_signed_dir = os.path.join(SIGNED_DIR, race_name)
        if not os.path.exists(race_signed_dir):
            return []
        
        pdfs = []
        for f in os.listdir(race_signed_dir):
            if f.lower().endswith('.pdf'):
                pdfs.append(f)
        return sorted(pdfs)

@ns.route('/<string:race_name>/pdf/<string:filename>')
class DownloadSignedPdf(Resource):
    @login_required
    def get(self, race_name, filename):
        """Download a specific signed PDF"""
        try:
            abs_signed_dir = os.path.abspath(SIGNED_DIR)
            race_signed_dir = os.path.join(abs_signed_dir, race_name)
            file_path = os.path.join(race_signed_dir, filename)
            
            if not os.path.exists(file_path):
                print(f"PDF not found: {file_path}")
                return api.abort(404, f"PDF file {filename} not found")
            
            return send_file(file_path, mimetype='application/pdf')
            
        except Exception as e:
            print(f"Error serving PDF: {e}")
            return api.abort(500, str(e))

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5002)
