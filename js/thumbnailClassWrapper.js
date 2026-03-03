/** @module thumbnailClassWrapper
 * 
 * @file thumbnailClassWrapper.js
 * @requires module:generalHelpers:isObjEmpty
 * @description
 *  This module provides functions to handle the thumbnail bar functionality in the application.
 *  It includes generating thumbnails, handling thumbnail selection events, and updating thumbnail statuses.
 * @author Martin von Berg
 * @version 2.1.0
 * @license MIT
 * @todo multiselect of images in thumbnail bar with https://github.com/simonwep/viselect. Currently it is a simple multi-select with shift-click and ranges with no gaps are supported.
 */

import { isObjEmpty } from '../js/generalHelpers.js';

/**
 * Generates and shows the thumbnails for the images in the thumbnail pane below the map.
 * Activates the first thumbnail and shows its metadata in the right sidebar.
 * Activates listeners for the thumbnail change event, which shows the metadata of the newly selected image in the right sidebar.
 * 
 * HINT: This function was not moved to an ES6 module because of its interaction with the right sidebar and its events.
 * 
 * @param {string} target - ID of the HTML element where the thumbnails should be generated
 * @param {array} allImages - Array of all images, which should be shown as thumbnails
 * @param {object} options - Options for the thumbnail slider, e.g. like pageVarsForJs[0].sw_options
 * @param {object} deps - Dependencies for the previously global functions
 * 
 * @global {object} document The global document object
 * @global {object} allMaps[0] is set by this function to an LeafletChartJs instance.
 * @global {function} generateThumbnailHTML, showMetadataForImageIndex, metaTextEventListener, metaGPSEventListener, handleSaveButton, mapPosMarkerEventListener
 */
export async function handleThumbnailBar(target, allImages, options = {}, deps = {}) {
    const thumbnailElement = document.getElementById(target);
    if (!thumbnailElement) { return; }

    if ( !allImages || isObjEmpty(options) || isObjEmpty(deps)) {
      thumbnailElement.innerHTML = '<div id="thumbnail-bar" style="color:red">Error generating Thumbnail Bar!</div>';
      return;
    }

    // destructure dependencies for the previously global functions
    let {
        generateThumbnailHTML,
        showMetadataForImageIndex,
        metaTextEventListener,
        metaGPSEventListener,
        handleSaveButton,
        mapPosMarkerEventListener,
        lastImage
      } = deps;

    thumbnailElement.innerHTML = generateThumbnailHTML(allImages);
    const { ThumbnailSlider } = await import('../js/thumbnailClass.js');
    let th = new ThumbnailSlider(0, options);

    // show and activate the first thumbnail metadata and activate listeners for it
    if ( lastImage == 'undefined' || lastImage === null || isNaN(lastImage) ) { lastImage = 0; }  
    th.setActiveThumb(lastImage);
    showMetadataForImageIndex(lastImage);
    metaTextEventListener();
    metaGPSEventListener();
    handleSaveButton();
    mapPosMarkerEventListener('map0',th); // prio TODO: move this to the map class  ????
    // Review: Event listeners attached to document are never removed, which can lead to leaks.
    // Comment: This is intentional. There is only one thumbnail bar and one map at runtime.
    document.querySelector('.thumb_wrapper').addEventListener('thumbnailchange', function (event) {
      
      // call the function to show the image metadata in the right sidebar
      showMetadataForImageIndex(event.detail.newslide, event.detail.selectedIndexes || []);
      console.log('thumbnailchange detected: ', event.detail);

      // PRIO TODO: move this to the map class and update the map markers accordingly
      allMaps[0].removeAllMarkers();
      allMaps[0].createFotoramaMarkers(pageVarsForJs[0].imgdata, false);

      event.detail.selectedIndexes.forEach( index => { 
        //allMaps[0].setActiveMarker(index);
        let coords = pageVarsForJs[0].imgdata[index].coord; 
        if ( Array.isArray(coords) && coords.length === 2 && coords.every(v => Number.isFinite(parseFloat(v))) ) {
          allMaps[0].mapFlyTo(pageVarsForJs[0].imgdata[index].coord);
        }
        allMaps[0].mrk.forEach( marker => {
          if (coords[0] == marker._latlng['lat'] && coords[1] == marker._latlng['lng']) {
            allMaps[0].setActiveMarker(marker.options.id);
          }
        })
        
      });
      
      metaTextEventListener();
      metaGPSEventListener();
      handleSaveButton();
    });

    document.addEventListener('updateThumbnailStatus', function (event) {
      th.updateThumbnailStatus(event.detail.imageIndex, event.detail.imageStatus);
      console.log('updateThumbnailStatus detected: ', event.detail);
    });
    // Review: In clearThumbnailBar, th is set to null and the DOM is replaced, but the thumbnailchange listener on .thumb_wrapper is never removed. If the thumbnail bar is recreated, those stale listeners will still fire and reference an invalid th/DOM. Please store the handler references created in handleThumbnailBar and explicitly remove them when clearing, or otherwise scope them so they’re tied to the specific wrapper instance and can be garbage-collected when replaced.
    // Comment: It works and no errors are shown, even if the image folder is changed.
    document.addEventListener('clearThumbnailBar', function (event) {
      event.preventDefault();
      th = null;
      thumbnailElement.innerHTML = '<div id="thumbnail-bar" style="color:red">'+event.detail.text+'</div>';
      // PRIO TODO: move this to the map class and update the map markers accordingly
      allMaps[0].removeAllMarkers();
    });

    document.addEventListener('mapmarkerclick', (event) => {
      console.log('mapmarkerclick detected: ', event.detail);
      th.setActiveThumb(event.detail.marker);
    });

    return;
}

/** generate the HTML for a thumbnail bar under the main map pane 
 * 
 * @param {object} allImages 
 * @returns {string} the HTML code for the thumbnail bar
 */
export function generateThumbnailHTML(allImages) {
  // generates the HTML for a thumbnail image including EXIF data
  if (!allImages || allImages.length === 0) return '<div>No images available</div>';
  // HTML should be like this:
  /*
  <div oncontextmenu="return false;" class="thumb_wrapper" style="height:75px;margin-top:5px">
    <div id="thumb_inner_0" class="thumb_inner">
        <div class="thumbnail_slide" id="thumb0" draggable="false"><img decoding="async" loading="lazy"
                class="th_wrap_0_img" draggable="false" style="margin-left:2px;margin-right:2px" height="75" width="75"
                src="http://localhost/wordpress/wp-content/uploads/test3/edinburgh_2018_01_gogh-150x150.avif"
                alt="Image Thumbnail 1 for Slider 0 operation"></div>
        <div class="thumbnail_slide" id="thumb1" draggable="false"><img decoding="async" loading="lazy"
                class="th_wrap_0_img" draggable="false" style="margin-left:2px;margin-right:2px" height="75" width="75"
                src="http://localhost/wordpress/wp-content/uploads/test3/edinburgh-2018-01-Monet1-150x150.avif"
                alt="Image Thumbnail 2 for Slider 0 operation"></div>
        <div class="thumbnail_slide" id="thumb2" draggable="false"><img decoding="async" loading="lazy"
                class="th_wrap_0_img" draggable="false" style="margin-left:2px;margin-right:2px" height="75" width="75"
                src="http://localhost/wordpress/wp-content/uploads/test3/PXL_20240302_072237288-150x150.avif"
                alt="Image Thumbnail 3 for Slider 0 operation"></div>
        <div class="thumbnail_slide" id="thumb3" draggable="false"><img decoding="async" loading="lazy"
                class="th_wrap_0_img" draggable="false" style="margin-left:2px;margin-right:2px" height="75" width="75"
                src="http://localhost/wordpress/wp-content/uploads/test3/MG_2049-150x150.avif"
                alt="Image Thumbnail 4 for Slider 0 operation"></div>
        <div class="thumbnail_slide" id="thumb4" draggable="false"><img decoding="async" loading="lazy"
                class="th_wrap_0_img" draggable="false" style="margin-left:2px;margin-right:2px" height="75" width="75"
                src="http://localhost/wordpress/wp-content/uploads/test3/PXL_20240616_124123117-150x150.avif"
                alt="Image Thumbnail 5 for Slider 0 operation"></div>
        <div class="thumbnail_slide" id="thumb5" draggable="false"><img decoding="async" loading="lazy"
                class="th_wrap_0_img" draggable="false" style="margin-left:2px;margin-right:2px" height="75" width="75"
                src="http://localhost/wordpress/wp-content/uploads/test3/PXL_20240714_1527431402-150x150.avif"
                alt="Image Thumbnail 6 for Slider 0 operation"></div>
    </div>
  </div>
  */
  let html = '<div class="thumb_wrapper"><div id="thumb_inner_0" class="thumb_inner">';
  let cssClassGps = '';
  
  allImages.forEach( (img, index) => {
    if (img.thumbnail == img.imagePath) {
      img.src = img.imagePath;
    } else {
      img.src = img.thumbnail;
    }
    if (img.status === 'loaded-with-GPS') cssClassGps = 'thumb_with_gps';
    else cssClassGps = 'thumb_no_gps';

    html += `<div class="thumbnail_slide ${cssClassGps}" id="thumb${index}" draggable="false">
        <img decoding="async" loading="lazy" class="th_wrap_0_img" draggable="false" 
          src="${img.src}" alt="Thumbnail ${index + 1}"></div>`;
  });

  html += '</div></div>';
  return html;
}

/**
 * Dispatches the event to update the thumbnail status in the thumbnail bar.
 *  
 * @param {number} imageIndex - index of the image in the thumbnail bar
 * @param {string} imageStatus - status of the image, can be one of:
 *   - 'loaded-with-GPS' - image has been geotagged and GPS information is available
 *   - 'geotagged' - image has been geotagged and GPS information is available
 *   - 'gps-manually-changed' - GPS information has been manually changed
 *   - 'thumb_all_meta_saved' - all metadata of the image has been saved
 *   - 'meta-manually-changed' - metadata of the image has been manually changed
 */
export function triggerUpdateThumbnailStatus(imageIndex, imageStatus) {
  // Dispatch an event to notify other parts of the application
  const event = new CustomEvent('updateThumbnailStatus', {
    detail: {
      imageIndex: imageIndex,
      imageStatus: imageStatus
    }
  });
  document.dispatchEvent(event);
  return;
}
