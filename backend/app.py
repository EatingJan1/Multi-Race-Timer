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
import secrets

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
USERS_FILE = 'var/users.json'

def load_users():
    if not os.path.exists(USERS_FILE):
        # Create default admin user if file doesn't exist
        default_users = {
            os.environ.get('ADMIN_USER', 'admin'): {
                "password": os.environ.get('ADMIN_PASS', 'password'),
                "permissions": {
                    "is_admin": True,
                    "can_start": True,
                    "can_stop": True,
                    "can_edit_form": True,
                    "can_edit_stats": True,
                    "can_edit_participants": True,
                    "can_add_participants": True,
                    "can_edit_settings": True,
                    "can_manage_users": True
                }
            }
        }
        print("Creating default admin user: " + os.environ.get('ADMIN_USER', 'admin'))
        with open(USERS_FILE, 'w') as f:
            json.dump(default_users, f, indent=4)
        return default_users
    
    try:
        with open(USERS_FILE, 'r') as f:
            users = json.load(f)
            # Ensure all users have permissions key
            modified = False
            for user, data in users.items():
                if "permissions" not in data:
                    # Grant admin ALL permissions, others NONE by default
                    # Grant admin ALL permissions, others basic view by default
                    if user == os.environ.get('ADMIN_USER', 'admin'):
                        data["permissions"] = {
                            "is_admin": True,
                            "can_start": True,
                            "can_stop": True,
                            "can_edit_form": True,
                            "can_edit_stats": True,
                            "can_edit_participants": True,
                            "can_add_participants": True,
                            "can_edit_settings": True,
                            "can_manage_users": True,
                            "can_see_all": True,
                            "hide_ranking": False,
                            "hide_duration": False
                        }
                    else:
                        data["permissions"] = {
                            "can_see_all": True,
                            "hide_ranking": False,
                            "hide_duration": False
                        }
                    modified = True
                
                if "race_access" not in data:
                    data["race_access"] = {}
                    modified = True
            if modified:
                save_users(users)
            return users
    except Exception:
        return {}

def save_users(users):
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f, indent=4)

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

def permission_required(perm):
    """
    Decorator to check if the current user has a specific permission.
    If the user has 'is_admin' permission, all checks pass.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not session.get('logged_in'):
                return {'message': 'Authentication required'}, 401
            
            permissions = session.get('permissions', {})
            # Admin override
            if permissions.get('is_admin'):
                return f(*args, **kwargs)
            
            # Fresh lookup for race specific access
            username = session.get('user')
            users = load_users()
            user_data = users.get(username, {})
            race_access = user_data.get('race_access', {})
            
            race_name = kwargs.get('race_name')
            # Need race-specific context check
            if race_name:
                # If can_see_all is enabled, user has access to all races
                # Fallback path: race_access -> global default
                if permissions.get('can_see_all'):
                    # Check for explicit override first
                    if race_name in race_access:
                        race_perms = race_access[race_name]
                        if not race_perms.get(perm):
                            return {'message': f"Permission denied for race {race_name} (Override): {perm}"}, 403
                    else:
                        # No override, use global permission
                        if not permissions.get(perm):
                             return {'message': f"Global permission denied for race {race_name}: {perm}"}, 403
                else:
                    # Selective access: must be in race_access
                    if race_name not in race_access:
                         return {'message': f"No access to race: {race_name}"}, 403
                    
                    race_perms = race_access[race_name]
                    if not race_perms.get(perm):
                        return {'message': f"Permission denied for race {race_name}: {perm}"}, 403
            else:
                # Global resource check
                if not permissions.get(perm):
                    return {'message': f"Global permission denied: {perm}"}, 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

# Authentication Endpoints
@auth_ns.route('/login')
class Login(Resource):
    def post(self):
        """Login to the application"""
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        users = load_users()
        
        if username in users and users[username]["password"] == password:
            session['logged_in'] = True
            session['user'] = username
            session['permissions'] = users[username].get("permissions", {})
            session['race_access'] = users[username].get("race_access", {})
            print("Login successful for user: " + username)

            session.permanent = True  # Make cookie persistent
            return {
                'status': 'success', 
                'message': 'Logged in successfully',
                'user': username,
                'permissions': users[username].get("permissions", {}),
                'race_access': users[username].get("race_access", {})
            }, 200
        
        return {'status': 'error', 'message': 'Invalid credentials'}, 401

@auth_ns.route('/users')
class UserList(Resource):
    @permission_required('can_manage_users')
    def get(self):
        """List all users (with permissions)"""
        users = load_users()
        result = []
        for username, data in users.items():
            result.append({
                "username": username,
                "permissions": data.get("permissions", {}),
                "race_access": data.get("race_access", {})
            })
        return result, 200

    @permission_required('can_manage_users')
    def post(self):
        """Create or update a user"""
        data = request.json
        username = data.get('username')
        password = data.get('password')
        permissions = data.get('permissions', {})
        
        race_access = data.get('race_access', {})
        
        if not username:
            abort(400, "Username required")
        
        users = load_users()
        current_username = session.get('user')
        current_user_is_admin = session.get('permissions', {}).get('is_admin')

        # MANAGER RESTRICTIONS
        if not current_user_is_admin:
            # 1. Cannot grant is_admin
            if permissions.get('is_admin'):
                return {'message': 'Nur System-Admins können Admin-Rechte vergeben.'}, 403
            
            # 2. Cannot edit existing admin accounts
            if username in users and users[username].get('permissions', {}).get('is_admin'):
                return {'message': 'System-Administratoren können nicht von Managern bearbeitet werden.'}, 403
            
            # 3. Cannot edit self (prevent privilege escalation/self lockout)
            if username == current_username:
                 return {'message': 'Sie können Ihren eigenen User nicht über die Benutzerverwaltung bearbeiten (nutzen Sie "Mein Profil").'}, 403

        # If user exists, optionally keep password if not provided
        if username in users:
            if not password:
                password = users[username]["password"]
        elif not password:
             abort(400, "Password required for new user")

        users[username] = {
            "password": password,
            "permissions": permissions,
            "race_access": race_access
        }
        save_users(users)
        return {'status': 'success'}, 200

@auth_ns.route('/users/<string:username>')
class UserDetail(Resource):
    @permission_required('can_manage_users')
    def delete(self, username):
        """Delete a user"""
        users = load_users()
        current_username = session.get('user')
        current_user_is_admin = session.get('permissions', {}).get('is_admin')

        if username not in users:
            abort(404, "User not found")
        
        # MANAGER RESTRICTIONS
        if not current_user_is_admin:
             if users[username].get('permissions', {}).get('is_admin'):
                 return {'message': 'System-Administratoren können nicht gelöscht werden.'}, 403
             if username == current_username:
                 return {'message': 'Sie können sich nicht selbst löschen.'}, 403

        if len(users) <= 1:
            abort(400, "Cannot delete the last user")
        
        users.pop(username)
        save_users(users)
        return {'status': 'success'}, 200

@auth_ns.route('/logout')
class Logout(Resource):
    def post(self):
        """Logout from the application"""
        session.clear()
        return {'status': 'success', 'message': 'Logged out successfully'}, 200

@auth_ns.route('/profile')
class UserProfile(Resource):
    def post(self):
        """Allow user to change their own password"""
        if not session.get('logged_in'):
             return {'message': 'Authentication required'}, 401
        
        username = session.get('user')
        data = request.json
        new_password = data.get('password')
        
        if not new_password:
             abort(400, "New password required")
             
        users = load_users()
        if username in users:
            users[username]["password"] = new_password
            save_users(users)
            return {'status': 'success'}, 200
        
        abort(404, "User not found")

@auth_ns.route('/status')
class AuthStatus(Resource):
    def get(self):
        """Check authentication status with fresh permissions"""
        if session.get('logged_in'):
            username = session.get('user')
            users = load_users()
            user_data = users.get(username, {})
            perms = user_data.get("permissions", {})
            race_access = user_data.get("race_access", {})
            
            # Also update session to be sure
            session['permissions'] = perms
            
            return {
                'logged_in': True, 
                'user': username,
                'permissions': perms,
                'race_access': race_access
            }
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
                    "displaytype": "hidden",
                    "form_config": []
                }

            return data
    return {
        "people": [],
        "settings": {
            "displaytype": "hidden",
            "form_config": []
        },
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
        """List all available race files (filtered by permission)"""
        all_files = [f.replace('.json', '') for f in os.listdir(DATA_DIR) if f.endswith('.json')]
        
        username = session.get('user')
        users = load_users()
        user_data = users.get(username, {})
        perms = user_data.get('permissions', {})
        race_access = user_data.get('race_access', {})
        
        # Admins and users with 'can_see_all' see all races
        if perms.get('is_admin') or perms.get('can_see_all'):
            return sorted(all_files, reverse=True)
            
        # Others only see assigned races
        visible_races = [r for r in all_files if r in race_access]
        return sorted(visible_races, reverse=True)

@ns.route('/<string:race_name>/people')
class PersonList(Resource):
    @ns.marshal_list_with(person_model)
    @permission_required('can_see_all')
    def get(self, race_name):
        """List all people in a specific race"""
        data = load_data(race_name)
        return data['people']

    @permission_required('can_edit_participants')
    def put(self, race_name):
        """Import or update people in a specific race"""
        people = request.json
        data = load_data(race_name)
        data['people'] = people
        save_data(race_name, data)
        return data['people'], 201
    
@ns.route('/<string:race_name>/people/append')
class PersonAppend(Resource):
    @ns.marshal_list_with(person_model)
    @permission_required('can_add_participants')
    def post(self, race_name):
        """Append People to a specific race"""
        people = request.json
        data = load_data(race_name)
        data['people'] += people
        save_data(race_name, data)
        return data['people'], 201

@ns.route('/<string:race_name>/settings')
class RaceSettings(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Get race settings"""
        data = load_data(race_name)
        return data.get('settings', {})

    @permission_required('can_edit_settings')
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
        """List public races for landing page (lite view)"""
        files = [f.replace('.json', '') for f in os.listdir(DATA_DIR) if f.endswith('.json')]
        public_races = []
        for race_name in files:
            data = load_data(race_name)
            settings = data.get('settings', {})
            
            # Lite view: Remove heavy form_config and sensitive key
            lite_settings = {k: v for k, v in settings.items() if k not in ['form_config', 'key']}
            
            display_type = lite_settings.get('displaytype', 'hidden')
            if display_type not in ['hidden', 'kiosk']:
                public_races.append({
                    'name': race_name,
                    'settings': lite_settings
                })
        return sorted(public_races, key=lambda x: x['name'], reverse=True)

@public_ns.route('/race/<string:race_name>')
class PublicRaceDetail(Resource):
    def get(self, race_name):
        """Get full details for a specific race publicly"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        # Remove private key if any
        if 'key' in settings:
            settings_copy = settings.copy()
            settings_copy.pop('key')
            data['settings'] = settings_copy
            
        return data

@public_ns.route('/settings/<string:race_name>')
class PublicRaceSettings(Resource):
    def get(self, race_name):
        """Get only settings for a specific race publicly (includes form_config)"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        if 'key' in settings:
            settings.pop('key')
        return settings

@public_ns.route('/register/<string:race_name>')
class PublicRegister(Resource):
    def post(self, race_name):
        """Register for a race"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        registration_data = request.json # Contains participant info
        print(settings.get('displaytype', 'hidden'))
        
        if settings.get('displaytype', 'hidden') == 'registration_stop' or settings.get('displaytype', 'hidden') == 'finished':
            abort(403, "Registration is closed or not allowed")

        if settings.get('displaytype', 'hidden') == 'kiosk' and settings.get('key', '') != registration_data.get('key'):
            abort(403, "No access to this race")
            
        signed_pdf_base64 = registration_data.get('signed_pdf') # Base64 of final PDF
        
        # Add person to race
        min_num = settings.get('start_num_min', 100)
        print(min_num)
        max_num = settings.get('start_num_max', 9999)
        print(max_num)
        
        used_numbers = [p['start_number'] for p in data['people']]
        
        # Find first available number in range
        start_num = min_num
        while start_num in used_numbers and start_num <= max_num:
            start_num += 1
            
        if start_num >= max_num:
            abort(400, "Keine freien Startnummern mehr in diesem Bereich!")

        new_person = {
            'id': str(start_num),
            'name': registration_data.get('name'),
            'start_number': start_num,
            'tags': registration_data.get('tags', []),
            'start_time': None,
            'end_time': None,
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

@public_ns.route('/kiosk/register/<string:race_name>')
class PublicParticipants(Resource):
    def post(self, race_name):
        """Use Key acsses Kiosk Mode"""
        json = request.json
        SECKEY = json.get("SECKEY", "")
        data = load_data(race_name)
        settings = data.get('settings', {})
        key = settings.get('key', "") 

        if key != SECKEY:
            abort(403, "No access to this race")
        
        return {"Race" : load_data(race_name)}


@public_ns.route('/results/<string:race_name>')
class PublicParticipants(Resource):
    def get(self, race_name):
        """Get public participant list/results for a race"""
        data = load_data(race_name)
        # Return only people, sanitized if necessary (though current person object is public-friendly)
        if data.get('settings', {}).get('displaytype', 'hidden') != 'finished':
            abort(403, "Race is not closed")
        
        return data.get('people', [])

@ns.route('/<string:race_name>/full')
class FullData(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Get full race data as JSON"""
        return load_data(race_name)

    @login_required
    def put(self, race_name):
        """Upload full race data as JSON"""
        data = request.json
        save_data(race_name, data)
        return data, 201


@ns.route('/<string:race_name>/start/<int:start_number>')
class StartPerson(Resource):
    @permission_required('can_start')
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
                found = True
                break
        if not found: abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'started', 'timestamp': timestamp}

@ns.route('/<string:race_name>/stop/<int:start_number>')
class StopPerson(Resource):
    @permission_required('can_stop')
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
                    abort(400, "Not started")
                person['end_time'] = timestamp
                #start_dt = datetime.datetime.fromisoformat(person['start_time'])
                #end_dt = datetime.datetime.fromisoformat(timestamp)
                #person['duration'] = (end_dt - start_dt).total_seconds()
                found = True
                break
        if not found: abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'stopped', 'timestamp': timestamp}

@ns.route('/<string:race_name>/delete')
class DeleteRace(Resource):
    @permission_required('can_edit_settings')
    def delete(self, race_name):
        """Delete a race file"""
        path = get_race_path(race_name)
        if os.path.exists(path):
            os.remove(path)
            return {'status': 'deleted'}
        abort(404)

@ns.route('/<string:race_name>/export')
class ExportRace(Resource):
    @permission_required('can_see_all')
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
    @permission_required('can_see_all')
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
    @permission_required('can_see_all')
    def get(self, race_name, filename):
        """Download a specific signed PDF"""
        try:
            abs_signed_dir = os.path.abspath(SIGNED_DIR)
            race_signed_dir = os.path.join(abs_signed_dir, race_name)
            file_path = os.path.join(race_signed_dir, filename)
            
            if not os.path.exists(file_path):
                print(f"PDF not found: {file_path}")
                return abort(404, f"PDF file {filename} not found")
            
            return send_file(file_path, mimetype='application/pdf')
            
        except Exception as e:
            print(f"Error serving PDF: {e}")
            return abort(500, str(e))
        

@ns.route('/<string:race_name>/genkey')
class FullData(Resource):

    @login_required
    def get(self, race_name):
        """Upload full race data as JSON"""
        
        data = load_data(race_name)
        settings = data.get("settings", {})
        key = settings.get("key", "")

        if key == "":
            token = secrets.token_urlsafe()
            data['settings']['key'] = token
            save_data(race_name, data)
            return {"key" : token}, 201 

        return {"status": "success", "key" : key}, 200
    

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5002)
