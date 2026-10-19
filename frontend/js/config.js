/**
 * js/config.js – API-URLs und Konstanten
 */

const IS_DEV_PORT = window.location.port === '8000';
const API_ORIGIN = (IS_DEV_PORT || window.location.port === '5002')
    ? `${window.location.protocol}//${window.location.hostname}:5002`
    : `${window.location.origin}/api`;

const API_BASE    = `${API_ORIGIN}/race`;
const AUTH_BASE   = `${API_ORIGIN}/auth`;
const PUBLIC_BASE = `${API_ORIGIN}/public`;

const GITHUB_LATEST_RELEASE_API =
    'https://api.github.com/repos/EatingJan1/Multi-Race-Timer/releases/latest';

const DEFAULT_COLUMNS = [
    { id: 'number',   label: 'STARTNR.',   visible: true, required: true,  key: 'number'   },
    { id: 'name',     label: 'NAME',        visible: true, required: true,  key: 'name'     },
    { id: 'status',   label: 'STATUS',      visible: true, required: true,  key: 'status'   },
    { id: 'start',    label: 'STARTZEIT',   visible: true, required: false, key: 'start'    },
    { id: 'duration', label: 'DAUER',       visible: true, required: false, key: 'duration' },
    { id: 'end',      label: 'ENDZEIT',     visible: true, required: false, key: 'end'      },
    { id: 'rank',     label: 'PLATZ',       visible: true, required: false, key: 'rank'     },
    { id: 'gap',      label: 'RÜCKSTAND',   visible: true, required: false, key: 'gap'      },
];

const GLOBAL_PERM_KEYS = [
    'is_admin', 'can_start', 'can_stop', 'can_edit_form', 'can_edit_stats',
    'can_edit_participants', 'can_add_participants', 'can_edit_settings',
    'can_manage_users', 'can_see_all', 'hide_ranking', 'hide_duration',
];
