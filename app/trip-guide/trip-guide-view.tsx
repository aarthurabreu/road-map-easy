'use client';

/* Official Places photo URLs cannot use a fixed Next Image host allowlist. */
/* eslint-disable @next/next/no-img-element */
import {
  Bike, BusFront, Car, Check, ChevronDown, Clock3, Compass, Footprints, LocateFixed,
  Map as MapIcon, MapPin, Menu, Navigation, Plus, Search, Share2, SlidersHorizontal,
  Cloud, LogOut, Moon, Sun, ShieldCheck, Sparkles, Star, Trash2, X,
} from 'lucide-react';
import { languageOptions, type Language } from '../i18n';
import { accountIdentity } from '../data-privacy';
import { PrivacyDialog, LocationDialog } from '../privacy-dialog';
import { privacyCopy } from '../privacy-copy';
import { MapShareDialog } from '../map-share-dialog';
import { ModalDialog } from '../modal-dialog';
import type { useTripGuide } from './use-trip-guide';
import { pinColorChoices, placeKey, getPinColor } from './place-model';
import { LiveGoogleMap } from './live-google-map';
import { PlacePhoto, PhotoCredits, PlaceRow, MapsConnection } from './place-components';
import { userInitials, placesCountLabel, savedPlacesLabel, exploreSummary } from './formatting';
import { localizedCategory, localizedStatusLabel, localizedHours, formatDistance } from './google-places';
import { SyncNotice, syncStatusLabel } from './sync-notice';
import { uxCopy, deletionDescription } from './ux-copy';

export function TripGuideView({ controller }: { controller: ReturnType<typeof useTripGuide> }) {
  const {
    theme,
    themeReady,
    language,
    t,
    locale,
    places,
    selectedId,
    detailsDismissed,
    view,
    setView,
    query,
    setQuery,
    searchMode,
    setSearchMode,
    placesError,
    refreshPlaces,
    retryGoogleMaps,
    filterOpen,
    setFilterOpen,
    onlyOpen,
    setOnlyOpen,
    routeOpen,
    routePlace,
    removeTarget,
    openRemoveConfirmation,
    setRouteOpen,
    removeConfirmOpen,
    setRemoveConfirmOpen,
    mapPendingDelete,
    setMapPendingDelete,
    mapsOpen,
    setMapsOpen,
    shareMapName,
    setShareMapName,
    newMapName,
    setNewMapName,
    maps,
    currentMap,
    locationLabel,
    toast,
    setToast,
    zoom,
    setZoom,
    storageReady,
    isLocating,
    mapsStatus,
    mapsError,
    predictions,
    isSearchingGoogle,
    liveMap,
    setLiveMap,
    userPosition,
    trackLocation,
    mapPlaceCandidate,
    setMapPlaceCandidate,
    mapPlaceLoading,
    authOpen,
    setAuthOpen,
    privacyOpen,
    setPrivacyOpen,
    locationPromptOpen,
    setLocationPromptOpen,
    authUser,
    authLoading,
    authError,
    oauthClientId,
    syncStatus,
    syncConflicts,
    storageIssue,
    resolveSync,
    setSyncAttempt,
    locationAllowed,
    googleButtonRef,
    searchInputRef,
    toggleTheme,
    updateUserPosition,
    changeLanguage,
    visiblePlaces,
    todayLabel,
    openPlacesCount,
    soonPlacesCount,
    selected,
    showPlace,
    closePlaceDetails,
    saveNote,
    savePinColor,
    requestMyLocation,
    useMyLocation,
    stopLocationTracking,
    openRouteOptions,
    openDirections,
    createMap,
    openMap,
    selectGooglePrediction,
    selectPlaceFromMap,
    addMapPlaceCandidate,
    removeSelectedPlace,
    deleteMap,
    connectGoogleMaps,
    logout,
    exportMyData,
    deleteMyData
  } = controller;
  const ux = uxCopy[language];
  const noMatches = (searchMode === 'saved' && Boolean(query.trim())) || onlyOpen;
  if (!storageReady) return <main className="app-shell" aria-busy="true"><p role="status">{language === 'es' ? 'Cargando tus itinerarios…' : language === 'en' ? 'Loading your itineraries…' : 'Carregando seus roteiros…'}</p></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="Easy Road Map"><span><Compass size={20} /></span><strong>Easy Road Map</strong></div>
        <button className="trip-switcher" onClick={() => setMapsOpen(true)} aria-label={t.switchTrip}>
          <span className="trip-pin"><MapPin size={17} fill="currentColor" /></span>
          <span><small>{t.itinerary}</small><strong>{currentMap || t.createMap}</strong></span><ChevronDown size={17} />
        </button>
        <div className="header-actions">
          <span className={`live-pill ${mapsStatus === 'ready' ? 'online' : ''}`}><i />{mapsStatus === 'ready' ? t.mapsLive : t.connecting}</span>
          {authUser && <span className={`sync-pill ${syncStatus}`}><Cloud size={12} />{syncStatusLabel(syncStatus, language) ?? (syncStatus === 'synced' ? t.synced : syncStatus === 'error' ? t.syncError : t.syncing)}</span>}
          <label className="language-picker" title={t.language}><span>{language.toUpperCase()}</span><select value={language} onChange={(event) => changeLanguage(event.target.value as Language)} aria-label={t.language}>{languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>
          <button className="theme-toggle" onClick={toggleTheme} disabled={!themeReady} aria-label={theme === 'dark' ? t.enableLightMode : t.enableDarkMode} title={theme === 'dark' ? t.enableLightMode : t.enableDarkMode} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className={`avatar ${authUser ? 'signed-in' : ''}`} onClick={() => setAuthOpen(true)} aria-label={authUser ? `${t.openAccount} ${authUser.name}` : t.signInGoogle} title={authUser?.email || t.signInGoogle}>{authUser ? userInitials(authUser.name) : 'G'}</button>
        </div>
      </header>

      <section className="toolbar" aria-label={t.mapTools}>
        <label className="search-mode-picker"><select aria-label={ux.searchMode} value={searchMode} onChange={(event) => { setSearchMode(event.target.value as 'saved' | 'google'); setQuery(''); searchInputRef.current?.focus(); }}><option value="saved">{ux.saved}</option><option value="google">{ux.google}</option></select></label>
        <div className="search-wrap">
          <Search size={19} />
          <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchMode === 'google' ? t.searchMaps : t.searchItinerary} aria-label={searchMode === 'google' ? t.searchMaps : t.searchItinerary} autoComplete="off" />
          {isSearchingGoogle && <span className="search-spinner" aria-label={t.searching} />}
          {query && <button onClick={() => setQuery('')} aria-label={t.clearSearch}><X size={16} /></button>}
          {searchMode === 'google' && mapsStatus === 'ready' && query.trim().length >= 2 && (
            <div className="google-results" role="region" aria-label={t.mapsResults}>
              {predictions.map((prediction) => {
                const saved = places.some((item) => placeKey(item.placeId, item.destination ?? 'Madri') === placeKey(prediction.placeId, currentMap));
                return <button key={prediction.placeId} onClick={() => !saved && selectGooglePrediction(prediction)} disabled={saved}>
                  <span className="result-pin"><MapPin size={16} /></span>
                  <span><strong>{prediction.mainText}</strong><small>{prediction.secondaryText}</small></span>
                  {saved ? <em className="saved-result"><Check size={13} /> {t.saved}</em> : prediction.distanceMeters != null && <em>{formatDistance(prediction.distanceMeters, language)}</em>}
                </button>;
              })}
              {!isSearchingGoogle && predictions.length === 0 && <p>{t.noResults}</p>}
              {mapsError && <p className="search-api-warning">{mapsError}</p>}
              <div className="google-attribution"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
            </div>
          )}
        </div>
        <button className={`filter-button ${onlyOpen ? 'active' : ''}`} onClick={() => setFilterOpen((value) => !value)} aria-expanded={filterOpen} aria-controls="place-filters" aria-label={t.filterPlaces}>
          <SlidersHorizontal size={19} /><span>{t.filters}</span>{onlyOpen && <i />}
        </button>
        {filterOpen && (
          <div className="filter-popover" id="place-filters">
            <div><strong>{t.showOnMap}</strong><span>{placesCountLabel(visiblePlaces.length, t)}</span></div>
            <button role="checkbox" aria-checked={onlyOpen} onClick={() => setOnlyOpen((value) => !value)}>
              <span className={`checkbox ${onlyOpen ? 'checked' : ''}`}>{onlyOpen && <Check size={13} />}</span>
              {t.onlyOpen}
            </button>
          </div>
        )}
      </section>

      {(authUser || storageIssue) && <SyncNotice authenticated={Boolean(authUser)} status={syncStatus} conflicts={syncConflicts} data={{ maps, currentMap, places }} storageIssue={storageIssue} language={language} retry={() => setSyncAttempt((attempt) => attempt + 1)} resolve={resolveSync} download={() => { void exportMyData().catch(() => setToast(privacyCopy[language].failure)); }} />}
      {placesError && <div className="places-update-notice" role="status"><span>{placesError}</span><button onClick={refreshPlaces}>{ux.retry}</button></div>}
      <section className="workspace">
        <aside className="desktop-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">{todayLabel}</span><h1>{currentMap ? `${t.yourItinerary} ${currentMap}` : t.firstItinerary}</h1><p>{placesCountLabel(visiblePlaces.length, t)}</p></div>
          </div>
          {currentMap && visiblePlaces.length > 0 && <div className="progress-card"><span><Sparkles size={15} /> {openPlacesCount > 0 ? t.goodTime : t.planStop}</span><p>{exploreSummary(openPlacesCount, soonPlacesCount, t)}</p><div className="status-summary"><span><i className="open" />{openPlacesCount} {openPlacesCount === 1 ? t.openSingular : t.openPlural}</span><span><i className="soon" />{soonPlacesCount} {t.soon}</span></div></div>}
          <div className="place-list desktop-list">
            {visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selectedId} language={language} onSelect={() => showPlace(place.id)} />)}
          </div>
          {currentMap && visiblePlaces.length === 0 && <div className="panel-empty"><MapPin size={22} /><strong>{noMatches ? ux.noMatches : t.emptyItinerary}</strong><span>{noMatches ? ux.clearHint : t.emptyItineraryHint}</span></div>}
          <button className="add-place-button" onClick={() => currentMap ? (setSearchMode('google'), setQuery(''), searchInputRef.current?.focus()) : setMapsOpen(true)}><Plus size={18} /> {currentMap ? t.addFromMaps : t.createFirstMap}</button>
        </aside>

        <div className={`map-area ${view === 'list' ? 'mobile-list-view' : ''}`}>
          <div className={`map-canvas ${mapsStatus === 'ready' ? 'map-canvas-hidden' : ''}`} style={{ '--map-scale': zoom } as React.CSSProperties}>
            <div className="map-text label-sol">SOL</div><div className="map-text label-retiro">RETIRO</div>
            <div className="map-text street-one">Calle de Alcalá</div><div className="map-text street-two">Gran Vía</div>
            <div className="park park-one" /><div className="park park-two" /><div className="water" />
            <div className="user-location" aria-label={t.yourLocation}><span /><i /><em>{locationLabel}</em></div>
            {visiblePlaces.map((place) => (
              <button key={place.id} className={`map-marker ${place.status} ${selectedId === place.id ? 'selected' : ''}`}
                style={{ left: `${place.x}%`, top: `${place.y}%`, background: getPinColor(place) }} onClick={() => showPlace(place.id)}
                aria-label={`${place.name}: ${place.statusLabel}`}>
                <span>{place.category === 'Restaurante' ? 'R' : place.category === 'Parque' ? 'P' : '◆'}</span>
              </button>
            ))}
            {visiblePlaces.length === 0 && <div className="empty-map"><Search size={24} /><strong>{currentMap ? t.noPlaceFound : t.createFirstMap}</strong><span>{currentMap ? t.removeFilters : t.organizeTrip}</span></div>}
          </div>
          {mapsStatus === 'ready' && storageReady && themeReady && <LiveGoogleMap places={visiblePlaces} selectedId={selectedId} onSelect={showPlace} onMapPlaceClick={selectPlaceFromMap} onUserPosition={updateUserPosition} onMapReady={setLiveMap} trackUser={trackLocation} userPosition={userPosition} language={language} theme={theme} />}
          {mapsStatus !== 'ready' && <MapsConnection status={mapsStatus} error={mapsError} onConnect={connectGoogleMaps} onRetry={retryGoogleMaps} language={language} />}
          {mapsStatus === 'ready' && <div className="map-add-hint"><Plus size={15} /> {t.tapMapToAdd}</div>}
          {mapPlaceLoading && <div className="maps-connect-card compact map-place-loading"><span className="search-spinner" /><strong>{t.loadingPlace}</strong></div>}
          <div className="map-controls"><button onClick={() => liveMap ? liveMap.setZoom(Math.min(20, (liveMap.getZoom() ?? 13) + 1)) : setZoom((value) => Math.min(1.14, value + .04))} aria-label={t.zoomIn}>+</button><button onClick={() => liveMap ? liveMap.setZoom(Math.max(2, (liveMap.getZoom() ?? 13) - 1)) : setZoom((value) => Math.max(.9, value - .04))} aria-label={t.zoomOut}>−</button></div>
          <button className={`locate-button ${isLocating ? 'locating' : ''}`} onClick={useMyLocation} aria-label={t.centerLocation} title={t.centerLocation} disabled={mapsStatus !== 'ready'}><LocateFixed size={21} /></button>

          <div className="mobile-list">
            <div className="mobile-list-heading">
              <div><span className="eyebrow">{todayLabel}</span><h2>{currentMap ? `${t.yourItinerary} ${currentMap}` : t.firstItinerary}</h2></div>
              <span>{placesCountLabel(visiblePlaces.length, t)}</span>
            </div>
            {currentMap && visiblePlaces.length > 0 && (
              userPosition
                ? <div className="distance-sort-state ready"><Navigation size={13} /> {t.nearestFirst}</div>
                : <button className="distance-sort-state" onClick={useMyLocation} disabled={isLocating}><LocateFixed size={13} /> {isLocating ? t.calculatingDistances : t.enableDistance}</button>
            )}
            <div className="place-list">{visiblePlaces.map((place) => <PlaceRow key={place.id} place={place} active={place.id === selectedId} language={language} onSelect={() => { showPlace(place.id); setView('map'); }} />)}</div>
            {visiblePlaces.length === 0 && <div className="panel-empty mobile-empty"><MapPin size={22} /><strong>{noMatches ? ux.noMatches : t.noPlaceItinerary}</strong><span>{noMatches ? ux.clearHint : t.returnMapHint}</span></div>}
          </div>

          {view === 'map' && !detailsDismissed && selected && visiblePlaces.some((place) => place.id === selected.id) && (
            <article className="place-card">
              <button className="close-card" onClick={closePlaceDetails} aria-label={t.closeDetails} title={t.closeDetails}><X size={18} /></button>
              <div className="place-photo">
                <span className="photo-placeholder"><MapPin size={30} /></span>
                <PlacePhoto place={selected} language={language} />
                <span className={`status-pill ${selected.status}`}><i />{localizedStatusLabel(selected.statusLabel, language)}</span><span className="rating"><Star size={13} fill="currentColor" /> {selected.rating}</span>
                <PhotoCredits place={selected} language={language} />
              </div>
              <div className="place-content">
                <div className="place-title"><div><span>{localizedCategory(selected.category, language)}</span><h2>{selected.name}</h2></div><strong>{selected.distance}</strong></div>
                <div className="meta-row"><MapPin size={16} /><span>{selected.address}</span></div>
                <div className="meta-row"><Clock3 size={16} /><span><strong>{localizedStatusLabel(selected.statusLabel, language)}</strong> · {t.today}, {localizedHours(selected.hours, language)}</span></div>
                <div className="pin-color-picker"><span>{t.pinColor}</span><div role="group" aria-label={t.choosePinColor}>
                  <button className={!selected.pinColor ? 'active auto-color' : 'auto-color'} onClick={() => savePinColor(undefined)} aria-pressed={!selected.pinColor} aria-label={t.useAutomaticColor} title={t.automaticColor}><Sparkles size={13} /></button>
                  {pinColorChoices.map(({ color, label }) => <button key={color} className={selected.pinColor === color ? 'active' : ''} style={{ '--choice-color': color } as React.CSSProperties} onClick={() => savePinColor(color)} aria-pressed={selected.pinColor === color} aria-label={`${t.pinColor}: ${t[label]}`} title={t[label]} />)}
                </div></div>
                <label className="note-field"><span>{t.personalNote}</span><input value={selected.note} onChange={(event) => saveNote(event.target.value)} /></label>
                <div className="place-actions">
                  <button className="remove-place-button" onClick={openRemoveConfirmation}><Trash2 size={16} /> {t.remove}</button>
                  <button className="go-button" onClick={openRouteOptions}><Navigation size={19} fill="currentColor" /> {t.goMaps}</button>
                </div>
              </div>
            </article>
          )}
        </div>
      </section>

      <nav className="bottom-nav" aria-label={t.mainNavigation}>
        <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><MapIcon size={21} /><span>{t.map}</span></button>
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><Menu size={21} /><span>{t.list}</span></button>
        <button onClick={() => setMapsOpen(true)}><Plus size={22} /><span>{t.newMap}</span></button>
      </nav>

      {authOpen && (
        <ModalDialog className="modal-backdrop auth-backdrop" onClose={() => setAuthOpen(false)} aria-labelledby="auth-title">
          <section className="auth-modal">
            <div className="modal-heading"><div><span>{t.yourAccount}</span><h2 id="auth-title">{authUser ? t.syncedItineraries : t.enterRoamly}</h2></div><button onClick={() => setAuthOpen(false)} aria-label={t.close}><X size={19} /></button></div>
            {authUser ? (
              <>
                <div className="account-card"><span className="account-avatar">{userInitials(authUser.name)}</span><span><strong>{authUser.name}</strong><small>{authUser.email}</small></span></div>
                <div className={`account-sync ${syncStatus}`}><ShieldCheck size={18} /><span><strong>{syncStatus === 'synced' ? t.cloudSaved : syncStatus === 'error' ? t.couldNotSync : t.syncingItineraries}</strong><small>{t.linkedGoogle}</small></span></div>
                {authError && <p role="alert">{authError}</p>}
                <button className="privacy-open-button" onClick={() => { setAuthOpen(false); setPrivacyOpen(true); }}><ShieldCheck size={16} /> {privacyCopy[language].title}</button>
                <button className="logout-button" onClick={logout} disabled={authLoading}><LogOut size={17} /> {t.logout}</button>
              </>
            ) : (
              <>
                <p className="auth-copy">{t.accessEverywhere}</p>
                <div ref={googleButtonRef} className="google-login-button" />
                {authLoading && <div className="auth-loading"><span className="search-spinner" /> {t.preparingLogin}</div>}
                {authError && <p className="auth-error">{authError}</p>}
                {!oauthClientId && !authLoading && <p className="auth-error">{t.googleNotConfigured}</p>}
                <p className="auth-privacy"><ShieldCheck size={14} /> {t.googlePrivacy}</p>
                <button className="privacy-open-button" onClick={() => { setAuthOpen(false); setPrivacyOpen(true); }}><ShieldCheck size={16} /> {privacyCopy[language].title}</button>
              </>
            )}
          </section>
        </ModalDialog>
      )}

      {privacyOpen && <PrivacyDialog
        language={language} email={authUser?.email} locationEnabled={locationAllowed}
        onClose={() => setPrivacyOpen(false)}
        onLocation={() => {
          if (locationAllowed) stopLocationTracking();
          else { setPrivacyOpen(false); setLocationPromptOpen(true); }
        }}
        onExport={exportMyData} onDelete={deleteMyData}
      />}
      {locationPromptOpen && <LocationDialog
        language={language}
        onClose={() => setLocationPromptOpen(false)}
        onAllow={() => { setLocationPromptOpen(false); requestMyLocation(); }}
      />}

      {routeOpen && routePlace && (
        <ModalDialog className="modal-backdrop" onClose={() => setRouteOpen(false)} aria-label={t.chooseTransport}>
          <section className="route-sheet">
            <div className="sheet-handle" />
            <div className="sheet-heading"><div><span>{t.routeTo}</span><h2>{routePlace.name}</h2><p>{t.leavingLocation}</p></div><button onClick={() => setRouteOpen(false)} aria-label={t.close}><X size={19} /></button></div>
            <div className="travel-grid">
              <button onClick={() => openDirections('walking')}><Footprints size={24} /><strong>{t.walk}</strong><span>{t.openRoute}</span></button>
              <button onClick={() => openDirections('driving')}><Car size={24} /><strong>{t.car}</strong><span>{t.openRoute}</span></button>
              <button onClick={() => openDirections('bicycling')}><Bike size={24} /><strong>{t.bike}</strong><span>{t.openRoute}</span></button>
              <button onClick={() => openDirections('transit')}><BusFront size={24} /><strong>{t.transit}</strong><span>{t.openRoute}</span></button>
            </div><p className="google-note">{t.routeOpensMaps}</p>
          </section>
        </ModalDialog>
      )}

      {removeConfirmOpen && removeTarget && (
        <ModalDialog className="modal-backdrop" onClose={() => setRemoveConfirmOpen(false)} role="alertdialog" aria-labelledby="remove-place-title" aria-describedby="remove-place-description">
          <section className="confirm-modal">
            <span className="confirm-icon"><Trash2 size={23} /></span>
            <div><span className="eyebrow">{t.removeFromItinerary}</span><h2 id="remove-place-title">{`${t.removeQuestion} ${removeTarget.name}?`}</h2><p id="remove-place-description">{deletionDescription(language, Boolean(authUser), false)}</p></div>
            <div className="confirm-actions"><button onClick={() => setRemoveConfirmOpen(false)}>{t.cancel}</button><button className="confirm-remove" onClick={removeSelectedPlace}><Trash2 size={16} /> {t.removePlace}</button></div>
          </section>
        </ModalDialog>
      )}

      {mapsOpen && (
        <ModalDialog className="modal-backdrop" onClose={() => setMapsOpen(false)} aria-label={t.yourMaps}>
          <section className="maps-modal">
            <div className="modal-heading"><div><span>{t.yourMaps}</span><h2>{t.whereTo}</h2></div><button onClick={() => setMapsOpen(false)} aria-label={t.close}><X size={19} /></button></div>
            {maps.length === 0 && <div className="places-unavailable maps-empty"><MapIcon size={23} /><strong>{t.noMaps}</strong><span>{t.noMapsHint}</span></div>}
            {maps.map((mapName, index) => (
              <div className="map-option-row" key={mapName}>
                <button className={`map-option ${currentMap === mapName ? 'selected' : ''}`} onClick={() => openMap(mapName)}>
                  <span className={`map-thumb ${index === 0 ? 'madrid' : 'lisbon'}`}>{mapName.slice(0,3).toUpperCase()}</span>
                  <span><strong>{mapName}</strong><small>{savedPlacesLabel(places.filter((place) => (place.destination ?? 'Madri') === mapName).length, t)}</small></span>
                  {currentMap === mapName && <Check size={19} />}
                </button>
                <button className="delete-map-button" onClick={() => setMapPendingDelete(mapName)} aria-label={`${t.deleteMap} ${mapName}`} title={`${t.deleteMap} ${mapName}`}><Trash2 size={17} /></button>
                <button className="share-map-button" onClick={() => {
                  setMapsOpen(false);
                  if (!authUser) { setAuthOpen(true); setToast(language === 'es' ? 'Inicia sesión para invitar a alguien' : language === 'en' ? 'Sign in to invite someone' : 'Entre na sua conta para convidar alguém'); return; }
                  if (syncStatus !== 'synced') { setToast(t.syncingItineraries); return; }
                  setShareMapName(mapName);
                }} aria-label={`${t.shareMap} ${mapName}`} title={t.shareMap}><Share2 size={17} /></button>
              </div>
            ))}
            <div className="new-map-form"><label htmlFor="new-map">{t.newDestination}</label><div><input id="new-map" value={newMapName} onChange={(event) => setNewMapName(event.target.value)} placeholder={t.destinationExample} onKeyDown={(event) => event.key === 'Enter' && createMap()} /><button onClick={createMap}><Plus size={18} /> {t.createMap}</button></div></div>
          </section>
        </ModalDialog>
      )}
      {shareMapName && authUser && <MapShareDialog mapName={shareMapName} language={language} email={authUser.email} identity={accountIdentity(authUser)} onClose={() => setShareMapName(null)} />}
      {mapPlaceCandidate && (
        <ModalDialog className="modal-backdrop map-place-backdrop" onClose={() => setMapPlaceCandidate(null)} aria-labelledby="map-place-title">
          <section className="maps-modal map-place-modal">
            <div className="modal-heading"><div><span>{t.mapsPlace}</span><h2 id="map-place-title">{t.addItinerary}</h2></div><button onClick={() => setMapPlaceCandidate(null)} aria-label={t.close}><X size={19} /></button></div>
            <div className="map-place-preview">
              <span className="map-place-photo"><MapPin size={24} /><PlacePhoto place={mapPlaceCandidate} language={language} /></span>
              <span><strong>{mapPlaceCandidate.name}</strong><small>{mapPlaceCandidate.address}</small><em>{localizedCategory(mapPlaceCandidate.category, language)} · {localizedStatusLabel(mapPlaceCandidate.statusLabel, language)}</em><PhotoCredits place={mapPlaceCandidate} language={language} className="candidate-photo-credit" /></span>
            </div>
            <div className="confirm-actions map-place-actions"><button onClick={() => setMapPlaceCandidate(null)}>{t.cancel}</button><button className="confirm-add" onClick={addMapPlaceCandidate}><Plus size={16} /> {t.addMap}</button></div>
            <div className="google-attribution modal-google"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
          </section>
        </ModalDialog>
      )}
      {mapPendingDelete && (
        <ModalDialog className="modal-backdrop map-delete-backdrop" onClose={() => setMapPendingDelete(null)} role="alertdialog" aria-labelledby="delete-map-title" aria-describedby="delete-map-description">
          <section className="confirm-modal">
            <span className="confirm-icon"><Trash2 size={23} /></span>
            <div><span className="eyebrow">{t.deleteMap.toLocaleUpperCase(locale)}</span><h2 id="delete-map-title">{t.deleteMap} {mapPendingDelete}?</h2><p id="delete-map-description">{deletionDescription(language, Boolean(authUser), true)}</p></div>
            <div className="confirm-actions"><button onClick={() => setMapPendingDelete(null)}>{t.cancel}</button><button className="confirm-remove" onClick={deleteMap}><Trash2 size={16} /> {t.deleteMap}</button></div>
          </section>
        </ModalDialog>
      )}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </main>
  );
}
