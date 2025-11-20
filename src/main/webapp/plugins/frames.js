/**
 * Copyright (c) 2020-2025, JGraph Holdings Ltd
 * Copyright (c) 2020-2025, draw.io AG
 */
/**
 * Frames plugin - Create named snapshots (frames) and navigate between them.
 * Similar to animation software, allows independent editing of each frame.
 */
(function() {
	// Wait for Draw object to be available
	function initFramesPlugin() {
		if (typeof Draw !== 'undefined' && Draw.loadPlugin) {
			Draw.loadPlugin(function(editorUi) {
				initPlugin(editorUi);
			});
		} else {
			// Retry after a short delay
			setTimeout(initFramesPlugin, 100);
		}
	}
	
	function initPlugin(editorUi) {
	
	// Debug: Check if editorUi is valid
	if (!editorUi || !editorUi.editor || !editorUi.editor.graph) {
		console.error('Frames plugin: editorUi not ready', editorUi);
		return;
	}
	
	console.log('Frames plugin: Loading...', editorUi);
	
	var graph = editorUi.editor.graph;
	var model = graph.model;
	var editor = editorUi.editor;
	
	// Frame storage - array of frame objects
	var frames = [];
	var currentFrameIndex = -1;
	var isNavigating = false; // Flag to prevent saving during navigation
	
	/**
	 * Frame object structure:
	 * {
	 *   id: unique identifier,
	 *   name: user-defined name,
	 *   xml: complete graph state as XML string,
	 *   timestamp: creation time,
	 *   thumbnail: optional thumbnail data,
	 *   undoHistory: array of undoable edits (for this frame's undo/redo)
	 * }
	 */
	
	/**
	 * Saves current graph state as XML
	 */
	function saveGraphState()
	{
		try
		{
			var xmlNode = editor.getGraphXml(true);
			return mxUtils.getXml(xmlNode);
		}
		catch (e)
		{
			editorUi.handleError(e);
			return null;
		}
	}
	
	/**
	 * Loads graph state from XML string
	 */
	function loadGraphState(xmlString)
	{
		try
		{
			var xmlDoc = mxUtils.parseXml(xmlString);
			var node = xmlDoc.documentElement;
			
			isNavigating = true;
			editor.setGraphXml(node);
			
			// Refresh the view and force validation
			graph.refresh();
			graph.view.validate();
			
			// Reset navigation flag after a short delay to allow rendering
			setTimeout(function() {
				isNavigating = false;
			}, 10);
			
			return true;
		}
		catch (e)
		{
			editorUi.handleError(e);
			isNavigating = false;
			return false;
		}
	}
	
	/**
	 * Generates thumbnail for a frame from XML
	 */
	function generateThumbnail(xmlString, callback)
	{
		try
		{
			// Create temporary graph using EditorUi's method
			var tempGraph = editorUi.createTemporaryGraph(graph.getStylesheet());
			tempGraph.shapeForegroundColor = graph.shapeForegroundColor;
			tempGraph.shapeBackgroundColor = graph.shapeBackgroundColor;
			
			// Load XML into temp graph
			var xmlDoc = mxUtils.parseXml(xmlString);
			var node = xmlDoc.documentElement;
			var dec = new mxCodec(node.ownerDocument);
			
			if (node.nodeName == 'mxGraphModel')
			{
				tempGraph.model.beginUpdate();
				try
				{
					tempGraph.model.clear();
					dec.decode(node, tempGraph.getModel());
				}
				finally
				{
					tempGraph.model.endUpdate();
				}
			}
			
			// Wait for graph to render
			setTimeout(function()
			{
				try
				{
					// Export to canvas
					editor.exportToCanvas(function(canvas)
					{
						try
						{
							if (canvas != null)
							{
								var dataUrl = canvas.toDataURL('image/png');
								callback(dataUrl);
							}
							else
							{
								callback(null);
							}
						}
						catch (e)
						{
							console.error('Error converting canvas:', e);
							callback(null);
						}
						finally
						{
							// Cleanup
							if (tempGraph.container.parentNode)
							{
								tempGraph.container.parentNode.removeChild(tempGraph.container);
							}
							tempGraph.destroy();
						}
					}, 120, null, '#ffffff', function()
					{
						callback(null);
						if (tempGraph.container.parentNode)
						{
							tempGraph.container.parentNode.removeChild(tempGraph.container);
						}
						tempGraph.destroy();
					}, null, null, null, null, null, null, tempGraph, 0);
				}
				catch (e)
				{
					console.error('Error in thumbnail generation:', e);
					callback(null);
					if (tempGraph.container.parentNode)
					{
						tempGraph.container.parentNode.removeChild(tempGraph.container);
					}
					tempGraph.destroy();
				}
			}, 200);
		}
		catch (e)
		{
			console.error('Error generating thumbnail:', e);
			callback(null);
		}
	}
	
	/**
	 * Creates a new frame from current state and adds to end
	 */
	function createFrame(name)
	{
		name = name || ('Frame ' + (frames.length + 1));
		
		var undoMgr = editor.undoManager;
		var undoHistory = null;
		if (undoMgr != null)
		{
			undoHistory = {
				history: undoMgr.history.slice(),
				indexOfNextAdd: undoMgr.indexOfNextAdd
			};
		}
		
		var frame = {
			id: 'frame_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9),
			name: name,
			xml: saveGraphState(),
			timestamp: new Date().getTime(),
			thumbnail: null,
			undoHistory: undoHistory
		};
		
		if (frame.xml == null)
		{
			editorUi.handleError({message: 'Failed to save frame state'});
			return null;
		}
		
		// Always append to end
		frames.push(frame);
		currentFrameIndex = frames.length - 1;
		
		// Generate thumbnail asynchronously
		generateThumbnail(frame.xml, function(thumb)
		{
			if (thumb != null)
			{
				frame.thumbnail = thumb;
				if (editorUi.framesTimeline != null)
				{
					editorUi.framesTimeline.refresh();
				}
			}
		});
		
		return frame;
	}
	
	
	/**
	 * Saves current frame's undo history
	 */
	function saveCurrentFrameUndoHistory()
	{
		if (currentFrameIndex >= 0 && currentFrameIndex < frames.length)
		{
			var undoMgr = editor.undoManager;
			if (undoMgr != null)
			{
				// Save undo history state
				frames[currentFrameIndex].undoHistory = {
					history: undoMgr.history.slice(), // Copy array
					indexOfNextAdd: undoMgr.indexOfNextAdd
				};
			}
		}
	}
	
	/**
	 * Restores frame's undo history
	 */
	function restoreFrameUndoHistory(index)
	{
		if (index >= 0 && index < frames.length)
		{
			var undoMgr = editor.undoManager;
			if (undoMgr != null && frames[index].undoHistory != null)
			{
				// Restore undo history state
				undoMgr.history = frames[index].undoHistory.history.slice();
				undoMgr.indexOfNextAdd = frames[index].undoHistory.indexOfNextAdd;
			}
			else
			{
				// No history for this frame, start fresh
				if (undoMgr != null)
				{
					undoMgr.clear();
				}
			}
		}
	}
	
	/**
	 * Navigates to a specific frame
	 * Saves current frame's undo history and restores target frame's undo history
	 */
	function navigateToFrame(index)
	{
		if (index < 0 || index >= frames.length)
		{
			return false;
		}
		
		// Save current frame's undo history before navigating
		if (currentFrameIndex >= 0)
		{
			saveCurrentFrameUndoHistory();
		}
		
		// Load the target frame snapshot
		if (loadGraphState(frames[index].xml))
		{
			currentFrameIndex = index;
			
			// Restore this frame's undo history
			restoreFrameUndoHistory(index);
			
			// Refresh timeline after graph view is updated
			// Use setTimeout to ensure graph rendering is complete
			setTimeout(function() {
				if (editorUi.framesTimeline != null && editorUi.framesTimeline.refresh)
				{
					editorUi.framesTimeline.refresh();
				}
			}, 50);
			
			// Also refresh immediately for instant feedback
			if (editorUi.framesTimeline != null && editorUi.framesTimeline.refresh)
			{
				editorUi.framesTimeline.refresh();
			}
			
			return true;
		}
		
		return false;
	}
	
	/**
	 * Navigates to previous frame
	 */
	function navigatePrevious()
	{
		if (currentFrameIndex > 0)
		{
			return navigateToFrame(currentFrameIndex - 1);
		}
		return false;
	}
	
	/**
	 * Navigates to next frame
	 */
	function navigateNext()
	{
		if (currentFrameIndex < frames.length - 1)
		{
			return navigateToFrame(currentFrameIndex + 1);
		}
		return false;
	}
	
	/**
	 * Deletes a frame
	 */
	function deleteFrame(index)
	{
		if (index < 0 || index >= frames.length)
		{
			return false;
		}
		
		frames.splice(index, 1);
		
		// Adjust current index
		if (currentFrameIndex >= frames.length)
		{
			currentFrameIndex = frames.length - 1;
		}
		else if (currentFrameIndex > index)
		{
			currentFrameIndex--;
		}
		
		// If we deleted the current frame, navigate to the previous one
		if (currentFrameIndex == index && currentFrameIndex >= 0)
		{
			navigateToFrame(currentFrameIndex);
		}
		else if (frames.length > 0 && currentFrameIndex < 0)
		{
			navigateToFrame(0);
		}
		else if (frames.length == 0)
		{
			currentFrameIndex = -1;
		}
		
		return true;
	}
	
	/**
	 * Renames a frame
	 */
	function renameFrame(index, newName)
	{
		if (index >= 0 && index < frames.length && newName)
		{
			frames[index].name = newName;
			return true;
		}
		return false;
	}
	
	/**
	 * Duplicates a frame
	 */
	function duplicateFrame(index)
	{
		if (index < 0 || index >= frames.length)
		{
			return false;
		}
		
		var originalFrame = frames[index];
		var newFrame = {
			id: 'frame_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9),
			name: originalFrame.name + ' (Copy)',
			xml: originalFrame.xml,
			timestamp: new Date().getTime()
		};
		
		frames.splice(index + 1, 0, newFrame);
		currentFrameIndex = index + 1;
		
		// Load the duplicated frame
		navigateToFrame(currentFrameIndex);
		
		return true;
	}
	
	/**
	 * Frame Management Timeline - Directly embedded in page bottom
	 */
	var FramesTimeline = function(editorUi)
	{
		// Create container div directly in body
		var container = document.createElement('div');
		container.id = 'framesTimelineContainer';
		container.style.position = 'fixed';
		container.style.bottom = '0';
		container.style.left = '0';
		container.style.right = '0';
		container.style.height = '120px';
		// Use light background (can be customized later)
		container.style.backgroundColor = '#f5f5f5';
		container.style.borderTop = '2px solid #ccc';
		container.style.zIndex = '10000';
		container.style.display = 'flex';
		container.style.flexDirection = 'row';
		container.style.alignItems = 'center';
		container.style.padding = '8px';
		container.style.boxSizing = 'border-box';
		container.style.overflowX = 'auto';
		container.style.overflowY = 'hidden';
		
		// Add to body
		document.body.appendChild(container);
		
		var div = document.createElement('div');
		div.style.padding = '8px';
		div.style.overflowX = 'auto';
		div.style.overflowY = 'hidden';
		div.style.height = '100%';
		div.style.boxSizing = 'border-box';
		div.style.display = 'flex';
		div.style.flexDirection = 'row';
		div.style.alignItems = 'center';
		div.style.gap = '8px';
		div.style.width = '100%';
		
		// Control buttons on the left
		var controlsDiv = document.createElement('div');
		controlsDiv.style.display = 'flex';
		controlsDiv.style.flexDirection = 'column';
		controlsDiv.style.gap = '5px';
		controlsDiv.style.flexShrink = 0;
		controlsDiv.style.marginRight = '10px';
		
		// Add Frame button
		var addBtn = mxUtils.button('+ Add Frame', function()
		{
			var frame = createFrame();
			if (frame != null)
			{
				refreshFrameWindow();
				// navigateToFrame will refresh the timeline
				navigateToFrame(currentFrameIndex);
			}
		});
		addBtn.style.padding = '5px 10px';
		addBtn.style.fontSize = '12px';
		controlsDiv.appendChild(addBtn);
		
		// Delete Frame button
		var deleteBtn = mxUtils.button('Delete Frame', function()
		{
			if (currentFrameIndex >= 0 && currentFrameIndex < frames.length)
			{
				if (mxUtils.confirm('Delete frame "' + frames[currentFrameIndex].name + '"?'))
				{
					deleteFrame(currentFrameIndex);
					refreshFrameWindow();
				}
			}
			else
			{
				editorUi.editor.setStatus('No frame selected');
			}
		});
		deleteBtn.style.padding = '5px 10px';
		deleteBtn.style.fontSize = '12px';
		deleteBtn.style.backgroundColor = '#ffebee';
		controlsDiv.appendChild(deleteBtn);
		
		div.appendChild(controlsDiv);
		
		// Frames timeline (horizontal scrollable)
		var framesList = document.createElement('div');
		framesList.id = 'framesList';
		framesList.style.display = 'flex';
		framesList.style.flexDirection = 'row';
		framesList.style.gap = '8px';
		framesList.style.overflowX = 'auto';
		framesList.style.overflowY = 'hidden';
		framesList.style.flex = '1';
		framesList.style.alignItems = 'center';
		div.appendChild(framesList);
		
		/**
		 * Refreshes the frame timeline display
		 */
		function refreshFrameWindow()
		{
			// Update button states
			var hasFrame = (currentFrameIndex >= 0 && currentFrameIndex < frames.length);
			deleteBtn.disabled = !hasFrame;
			
			// Clear and rebuild frames timeline
			framesList.innerHTML = '';
			
			// Store current index to ensure consistency during refresh
			var currentIdx = currentFrameIndex;
			
			for (var i = 0; i < frames.length; i++)
			{
				var frame = frames[i];
				var frameItem = document.createElement('div');
				frameItem.style.position = 'relative';
				frameItem.style.width = '100px';
				frameItem.style.height = '80px';
				frameItem.style.border = (i == currentIdx) ? '3px solid #2196F3' : '2px solid #ccc';
				frameItem.style.borderRadius = '4px';
				frameItem.style.cursor = 'pointer';
				frameItem.style.backgroundColor = '#f5f5f5';
				frameItem.style.flexShrink = 0;
				frameItem.style.display = 'flex';
				frameItem.style.flexDirection = 'column';
				frameItem.style.alignItems = 'center';
				frameItem.style.justifyContent = 'center';
				frameItem.style.overflow = 'hidden';
				
				// Thumbnail image
				var thumbImg = document.createElement('img');
				thumbImg.style.width = '100%';
				thumbImg.style.height = '100%';
				thumbImg.style.objectFit = 'contain';
				thumbImg.style.pointerEvents = 'none';
				
				if (frame.thumbnail != null)
				{
					thumbImg.src = frame.thumbnail;
				}
				else
				{
					// Placeholder while thumbnail is generating
					thumbImg.style.display = 'none';
					var placeholder = document.createElement('div');
					placeholder.style.width = '100%';
					placeholder.style.height = '100%';
					placeholder.style.display = 'flex';
					placeholder.style.alignItems = 'center';
					placeholder.style.justifyContent = 'center';
					placeholder.style.fontSize = '10px';
					placeholder.style.color = '#999';
					placeholder.textContent = 'Loading...';
					frameItem.appendChild(placeholder);
					
					// Generate thumbnail if not exists
					generateThumbnail(frame.xml, function(thumb)
					{
						if (thumb != null)
						{
							frame.thumbnail = thumb;
							placeholder.style.display = 'none';
							thumbImg.src = thumb;
							thumbImg.style.display = 'block';
						}
					});
				}
				
				frameItem.appendChild(thumbImg);
				
				// Frame number label at bottom
				var frameLabel = document.createElement('div');
				frameLabel.style.position = 'absolute';
				frameLabel.style.bottom = '0';
				frameLabel.style.left = '0';
				frameLabel.style.right = '0';
				frameLabel.style.backgroundColor = (i == currentIdx) ? 'rgba(33, 150, 243, 0.8)' : 'rgba(0, 0, 0, 0.6)';
				frameLabel.style.color = '#fff';
				frameLabel.style.fontSize = '10px';
				frameLabel.style.padding = '2px';
				frameLabel.style.textAlign = 'center';
				frameLabel.textContent = (i + 1);
				frameItem.appendChild(frameLabel);
				
				// Click to navigate
				frameItem.addEventListener('click', function(idx)
				{
					return function(evt)
					{
						navigateToFrame(idx);
					};
				}(i));
				
				// Hover effect
				frameItem.addEventListener('mouseenter', function()
				{
					this.style.opacity = '0.8';
				});
				frameItem.addEventListener('mouseleave', function()
				{
					this.style.opacity = '1';
				});
				
				framesList.appendChild(frameItem);
			}
			
			if (frames.length == 0)
			{
				var emptyMsg = document.createElement('div');
				emptyMsg.style.textAlign = 'center';
				emptyMsg.style.color = 'gray';
				emptyMsg.style.padding = '20px';
				emptyMsg.style.flex = '1';
				emptyMsg.textContent = 'No frames. Click "Add Frame" to create one.';
				framesList.appendChild(emptyMsg);
			}
		}
		
		// Append div to container
		container.appendChild(div);
		
		// Initial refresh
		refreshFrameWindow();
		
		// Expose refresh function and container
		this.refresh = refreshFrameWindow;
		this.container = container;
		this.div = div;
		
		// Adjust canvas container to leave space for timeline
		var adjustCanvasPadding = function()
		{
			var canvasContainer = graph.container;
			if (canvasContainer && canvasContainer.parentNode)
			{
				canvasContainer.style.paddingBottom = '120px';
			}
		};
		
		adjustCanvasPadding();
		
		// Re-adjust on window resize
		window.addEventListener('resize', adjustCanvasPadding);
		
		// Store reference
		this.adjustCanvasPadding = adjustCanvasPadding;
	};
	
	// Add resources
	mxResources.parse('frames=Frames...');
	mxResources.parse('createFrame=Create Frame');
	mxResources.parse('updateFrame=Update Frame');
	mxResources.parse('previousFrame=Previous Frame');
	mxResources.parse('nextFrame=Next Frame');
	
	// Add actions
	if (!editorUi.actions) {
		console.error('Frames plugin: actions not available');
		return;
	}
	
	// Create timeline directly (no action needed, always visible)
	// But keep action for menu compatibility
	editorUi.actions.addAction('frames...', function()
	{
		if (this.framesTimeline == null)
		{
			// Create timeline at bottom
			this.framesTimeline = new FramesTimeline(editorUi);
		}
		else
		{
			// Toggle visibility
			var isVisible = this.framesTimeline.container.style.display != 'none';
			this.framesTimeline.container.style.display = isVisible ? 'none' : 'flex';
			
			// Adjust canvas padding
			if (this.framesTimeline.adjustCanvasPadding)
			{
				this.framesTimeline.adjustCanvasPadding();
			}
		}
	});
	
	// Auto-create timeline on load
	setTimeout(function() {
		if (editorUi.framesTimeline == null)
		{
			editorUi.framesTimeline = new FramesTimeline(editorUi);
		}
	}, 1000);
	
	// Auto-update frame's undo history and state when editing (only if we're on a valid frame)
	var updateFrameTimeout = null;
	var frameUpdateDelay = 500; // Debounce delay in ms
	
	model.addListener(mxEvent.CHANGE, function(sender, evt)
	{
		// Only auto-update if:
		// 1. We're on a valid frame (not -1)
		// 2. We're not currently navigating between frames
		// 3. The edit is not ignored (e.g., programmatic changes)
		var edit = evt.getProperty('edit');
		if (currentFrameIndex >= 0 && !isNavigating && 
		    (edit == null || !edit.ignoreEdit))
		{
			// Debounce: clear previous timeout and set new one
			if (updateFrameTimeout != null)
			{
				clearTimeout(updateFrameTimeout);
			}
			
			// Update frame's undo history and state after a short delay to batch multiple changes
			updateFrameTimeout = setTimeout(function()
			{
				if (currentFrameIndex >= 0 && currentFrameIndex < frames.length && !isNavigating)
				{
					// Save undo history for this frame
					saveCurrentFrameUndoHistory();
					
					// Also update XML and thumbnail
					var xml = saveGraphState();
					if (xml != null)
					{
						frames[currentFrameIndex].xml = xml;
						frames[currentFrameIndex].timestamp = new Date().getTime();
						
						// Regenerate thumbnail asynchronously
						generateThumbnail(xml, function(thumb)
						{
							if (thumb != null)
							{
								frames[currentFrameIndex].thumbnail = thumb;
								if (editorUi.framesTimeline != null)
								{
									editorUi.framesTimeline.refresh();
								}
							}
						});
						
						// Refresh timeline immediately to show update
						if (editorUi.framesTimeline != null)
						{
							editorUi.framesTimeline.refresh();
						}
					}
				}
			}, frameUpdateDelay);
		}
	});
	
	console.log('Frames plugin: Action added', editorUi.actions.get('frames...'));
	
	// Keyboard shortcuts for navigation
	var keyHandler = new mxKeyHandler(graph);
	
	keyHandler.bindKey(37, function() // Left arrow
	{
		if (frames.length > 0)
		{
			navigatePrevious();
		}
	});
	
	keyHandler.bindKey(39, function() // Right arrow
	{
		if (frames.length > 0)
		{
			navigateNext();
		}
	});
	
	// Add to menu - use setTimeout to ensure menu is ready
	setTimeout(function() {
		var menu = editorUi.menus.get('extras');
		
		if (menu != null)
		{
			console.log('Frames plugin: Extras menu found, registering...');
			var oldFunct = menu.funct;
			
			menu.funct = function(menu, parent)
			{
				if (oldFunct != null)
				{
					oldFunct.apply(this, arguments);
				}
				editorUi.menus.addMenuItems(menu, ['-', 'frames'], parent);
			};
			
			console.log('Frames plugin: Menu registered successfully');
		}
		else
		{
			console.error('Frames plugin: extras menu not found', editorUi.menus);
		}
	}, 100);
	
	// Save frames data with file
	var originalGetFileData = editorUi.getFileData;
	editorUi.getFileData = function()
	{
		var data = originalGetFileData.apply(this, arguments);
		
		// Add frames data as metadata
		if (frames.length > 0)
		{
			try
			{
				var framesData = {
					frames: frames,
					currentFrameIndex: currentFrameIndex
				};
				
				// Try to add to file node
				if (this.fileNode != null)
				{
					var framesAttr = JSON.stringify(framesData);
					this.fileNode.setAttribute('frames', encodeURIComponent(framesAttr));
				}
			}
			catch (e)
			{
				console.error('Failed to save frames data', e);
			}
		}
		
		return data;
	};
	
	// Load frames data from file
	var originalSetFileData = editorUi.setFileData;
	editorUi.setFileData = function(xml, file)
	{
		originalSetFileData.apply(this, arguments);
		
		// Try to load frames data
		try
		{
			if (this.fileNode != null)
			{
				var framesAttr = this.fileNode.getAttribute('frames');
				if (framesAttr != null)
				{
					var framesData = JSON.parse(decodeURIComponent(framesAttr));
					frames = framesData.frames || [];
					currentFrameIndex = framesData.currentFrameIndex || -1;
					
					// Validate current index
					if (currentFrameIndex >= frames.length)
					{
						currentFrameIndex = frames.length > 0 ? frames.length - 1 : -1;
					}
					
					// Refresh timeline if exists
					if (this.framesTimeline != null)
					{
						this.framesTimeline.refresh();
					}
				}
			}
		}
		catch (e)
		{
			console.error('Failed to load frames data', e);
			frames = [];
			currentFrameIndex = -1;
		}
	};
	
	// Note: We do NOT auto-save frames on close
	// Frames are immutable snapshots - they should only be updated manually via "Update Frame" button
	}
	
	// Start initialization
	initFramesPlugin();
})();

